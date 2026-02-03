import {
  App,
  ItemView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  WorkspaceLeaf,
} from "obsidian";

type HighlightColor = "yellow" | "green" | "blue" | "flashcard";

interface HighlightRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface HighlightPage {
  page: number;
  rects: HighlightRect[];
}

interface Highlight {
  id: string;
  color: HighlightColor;
  isFlashcard: boolean;
  text: string;
  createdAt: string;
  pages: HighlightPage[];
  flashcardGenerated?: boolean;
}

interface HighlightFile {
  version: number;
  sourcePath: string;
  highlights: Highlight[];
}

interface Flashcard {
  id: string;
  sourcePath: string;
  highlightIds: string[];
  question: string;
  answer: string;
  createdAt: string;
}

interface FlashcardFile {
  version: number;
  cards: Flashcard[];
}

interface CardProgress {
  lastReviewedAt?: string;
  nextDueAt?: string;
  streak: number;
  intervalDays: number;
  done?: boolean;
}

interface ProgressFile {
  version: number;
  progress: Record<string, CardProgress>;
}

interface PluginSettings {
  apiKey: string;
  model: string;
  storageFolder: string;
}

const DEFAULT_SETTINGS: PluginSettings = {
  apiKey: "",
  model: "gpt-5.1",
  storageFolder: ".flashcards",
};

const HIGHLIGHT_VERSION = 1;
const FLASHCARD_VERSION = 1;
const PROGRESS_VERSION = 1;

const COLOR_MAP: Record<HighlightColor, string> = {
  yellow: "#ffe066",
  green: "#b2f2bb",
  blue: "#a5d8ff",
  flashcard: "#ffb3c1",
};

const FLASHCARD_VIEW_TYPE = "study-assist-flashcards-view";
const FLASHCARD_MANAGE_VIEW_TYPE = "study-assist-flashcards-manage";

class FlashcardView extends ItemView {
  private plugin: PdfFlashcardsPlugin;
  private cards: Flashcard[] = [];
  private index = 0;
  private showingAnswer = false;
  private progress: Record<string, CardProgress> = {};

  constructor(leaf: WorkspaceLeaf, plugin: PdfFlashcardsPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return FLASHCARD_VIEW_TYPE;
  }

  getDisplayText() {
    return "Flashcards";
  }

  async onOpen() {
    this.containerEl.empty();
    this.containerEl.addClass("study-assist-flashcard-view");
    await this.reload();
    this.render();
  }

  async reload() {
    this.cards = await this.plugin.loadAllCards();
    this.progress = await this.plugin.loadProgress();
    this.index = 0;
    this.showingAnswer = false;
  }

  async refresh() {
    await this.reload();
    this.render();
  }

  async onClose() {
    this.containerEl.empty();
  }

  private currentCard(): Flashcard | null {
    const remaining = this.remainingCards();
    if (remaining.length === 0) return null;
    return remaining[this.index % remaining.length];
  }

  private async handleGrade(isGood: boolean) {
    const card = this.currentCard();
    if (!card) return;
    await this.plugin.updateProgressOptimistic(card.id, isGood);
    this.progress = await this.plugin.loadProgress();
    const remaining = this.remainingCards();
    if (remaining.length > 0) {
      this.index = (this.index + 1) % remaining.length;
    } else {
      this.index = 0;
    }
    this.showingAnswer = false;
    this.render();
  }

  private remainingCards(): Flashcard[] {
    return this.cards.filter((card) => !this.progress[card.id]?.done);
  }

  private render() {
    this.containerEl.empty();

    const card = this.currentCard();
    const cardEl = this.containerEl.createDiv({ cls: "study-assist-flashcard-card" });
    const controls = this.containerEl.createDiv({ cls: "study-assist-flashcard-controls" });
    const meta = this.containerEl.createDiv({ cls: "study-assist-flashcard-meta" });

    if (!card) {
      if (this.cards.length === 0) {
        cardEl.setText("No flashcards yet. Generate some from PDF highlights.");
        return;
      }

      cardEl.setText("Congrats! You finished all flashcards.");
      controls.empty();
      const restartBtn = controls.createEl("button", { text: "Restart" });
      restartBtn.addEventListener("click", async () => {
        await this.plugin.resetProgress();
        await this.reload();
        this.render();
      });
      return;
    }

    cardEl.setText(this.showingAnswer ? card.answer : card.question);
    cardEl.addEventListener("click", () => {
      this.showingAnswer = !this.showingAnswer;
      this.render();
    });

    const againBtn = controls.createEl("button", { text: "Again" });
    const goodBtn = controls.createEl("button", { text: "Good" });

    againBtn.addEventListener("click", () => void this.handleGrade(false));
    goodBtn.addEventListener("click", () => void this.handleGrade(true));

    const remaining = this.remainingCards().length;
    meta.setText(`Remaining ${remaining} of ${this.cards.length}`);
  }
}

class FlashcardManageView extends ItemView {
  private plugin: PdfFlashcardsPlugin;
  private cards: Flashcard[] = [];

  constructor(leaf: WorkspaceLeaf, plugin: PdfFlashcardsPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return FLASHCARD_MANAGE_VIEW_TYPE;
  }

  getDisplayText() {
    return "Flashcards Manager";
  }

  async onOpen() {
    this.containerEl.empty();
    this.containerEl.addClass("study-assist-flashcard-manage");
    await this.reload();
    this.render();
  }

  async onClose() {
    this.containerEl.empty();
  }

  private async reload() {
    this.cards = await this.plugin.loadAllCards();
  }

  async refresh() {
    await this.reload();
    this.render();
  }

  private render() {
    this.containerEl.empty();

    const header = this.containerEl.createDiv({ cls: "study-assist-manage-header" });
    header.createEl("h3", { text: "Flashcards" });

    const addForm = this.containerEl.createDiv({ cls: "study-assist-manage-add" });
    const qInput = addForm.createEl("textarea");
    qInput.placeholder = "Question";
    const aInput = addForm.createEl("textarea");
    aInput.placeholder = "Answer";
    const addBtn = addForm.createEl("button", { text: "Add" });

    addBtn.addEventListener("click", async () => {
      const question = qInput.value.trim();
      const answer = aInput.value.trim();
      if (!question || !answer) return;

      const now = new Date().toISOString();
      const newCard: Flashcard = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        sourcePath: "manual",
        highlightIds: [],
        question,
        answer,
        createdAt: now,
      };

      this.cards.unshift(newCard);
      await this.plugin.replaceAllCards(this.cards);
      qInput.value = "";
      aInput.value = "";
      this.render();
    });

    const list = this.containerEl.createDiv({ cls: "study-assist-manage-list" });

    if (this.cards.length === 0) {
      list.setText("No flashcards yet.");
      return;
    }

    this.cards.forEach((card, index) => {
      const row = list.createDiv({ cls: "study-assist-manage-row" });
      const q = row.createEl("textarea");
      q.value = card.question;
      const a = row.createEl("textarea");
      a.value = card.answer;
      const actions = row.createDiv({ cls: "study-assist-manage-actions" });
      const saveBtn = actions.createEl("button", { text: "Save" });
      const deleteBtn = actions.createEl("button", { text: "Delete" });

      saveBtn.addEventListener("click", async () => {
        const question = q.value.trim();
        const answer = a.value.trim();
        if (!question || !answer) return;
        this.cards[index] = { ...card, question, answer };
        await this.plugin.replaceAllCards(this.cards);
      });

      deleteBtn.addEventListener("click", async () => {
        this.cards.splice(index, 1);
        await this.plugin.replaceAllCards(this.cards);
        await this.plugin.removeProgress(card.id);
        this.render();
      });
    });
  }
}

class PdfLeafController {
  private plugin: PdfFlashcardsPlugin;
  private leaf: WorkspaceLeaf;
  private toolbar?: HTMLDivElement;
  private observer?: MutationObserver;
  private retryTimer?: number;
  private attachedPdfViewer?: HTMLElement;
  private selectionHandlerAttached = false;
  private renderTimer?: number;

  constructor(plugin: PdfFlashcardsPlugin, leaf: WorkspaceLeaf) {
    this.plugin = plugin;
    this.leaf = leaf;
  }

  async init() {
    await this.ensureAttached();
  }

  destroy() {
    this.toolbar?.remove();
    this.observer?.disconnect();
    if (this.retryTimer) window.clearTimeout(this.retryTimer);
  }

  async ensureAttached(retries = 5) {
    const container = this.leaf.view.containerEl;
    if (!container) return;

    if (!this.toolbar || !container.contains(this.toolbar)) {
      this.toolbar = container.createDiv({ cls: "study-assist-pdf-toolbar" });
      this.buildToolbar(this.toolbar);
    }

    const pdfViewer = this.findPdfViewer();
    if (!pdfViewer) {
      if (retries > 0) {
        this.retryTimer = window.setTimeout(() => {
          void this.ensureAttached(retries - 1);
        }, 250);
      }
      return;
    }

    if (!this.selectionHandlerAttached) {
      container.addEventListener("mouseup", (event) => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) return;
        if (!selection.anchorNode) return;
        if (!container.contains(selection.anchorNode)) return;
        event.preventDefault();
      });
      this.selectionHandlerAttached = true;
    }

    if (this.observer && this.attachedPdfViewer !== pdfViewer) {
      this.observer.disconnect();
      this.observer = undefined;
      this.attachedPdfViewer = undefined;
    }

    if (!this.observer) {
      this.observer = new MutationObserver(() => {
        this.scheduleRenderHighlights();
      });
      this.observer.observe(pdfViewer, { childList: true, subtree: true });
      this.attachedPdfViewer = pdfViewer;
    }

    this.scheduleRenderHighlights();
  }

  private buildToolbar(toolbar: HTMLDivElement) {
    const buttons: { color: HighlightColor; label: string }[] = [
      { color: "yellow", label: "Yellow" },
      { color: "green", label: "Green" },
      { color: "blue", label: "Blue" },
      { color: "flashcard", label: "Flashcard" },
    ];

    buttons.forEach(({ color, label }) => {
      const btn = toolbar.createEl("button");
      const swatch = btn.createSpan({ cls: "study-assist-color-swatch" });
      swatch.style.background = COLOR_MAP[color];
      btn.createSpan({ text: label });

      btn.addEventListener("click", async () => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) {
          new Notice("Select text in the PDF first.");
          return;
        }

        const pdfViewer = this.findPdfViewer();
        if (!pdfViewer) {
          new Notice("PDF viewer not found.");
          return;
        }

        const highlight = this.buildHighlightFromSelection(selection, pdfViewer, color);
        if (!highlight) {
          new Notice("Could not capture selection.");
          return;
        }

        const file = this.getPdfFile();
        if (!file) {
          new Notice("No PDF file associated with this view.");
          return;
        }

        await this.plugin.saveHighlight(file.path, highlight);
        selection.removeAllRanges();
        await this.renderHighlights();
      });
    });
  }

  private findPdfViewer(): HTMLElement | null {
    const container = this.leaf.view.containerEl;
    if (!container) return null;
    return (
      container.querySelector(".pdf-viewer") ||
      container.querySelector(".pdfViewer") ||
      container.querySelector(".pdf-viewer-container")
    ) as HTMLElement | null;
  }

  private getPdfFile(): TFile | null {
    const view: any = this.leaf.view as any;
    if (view?.file instanceof TFile) return view.file as TFile;
    return this.leaf?.view?.file ?? null;
  }

  private buildHighlightFromSelection(
    selection: Selection,
    pdfViewer: HTMLElement,
    color: HighlightColor
  ): Highlight | null {
    if (selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    const rects = Array.from(range.getClientRects()).filter(
      (rect) => rect.width > 1 && rect.height > 1
    );
    if (rects.length === 0) return null;

    const pages = Array.from(pdfViewer.querySelectorAll(".page")) as HTMLElement[];
    if (pages.length === 0) return null;

    const pageMap = new Map<number, HighlightRect[]>();

    rects.forEach((rect) => {
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      const pageEl = pages.find((page) => {
        const box = page.getBoundingClientRect();
        return (
          centerX >= box.left &&
          centerX <= box.right &&
          centerY >= box.top &&
          centerY <= box.bottom
        );
      });

      if (!pageEl) return;
      const pageNumber = parseInt(pageEl.dataset.pageNumber ?? "1", 10) - 1;
      const box = pageEl.getBoundingClientRect();
      const norm: HighlightRect = {
        x: (rect.left - box.left) / box.width,
        y: (rect.top - box.top) / box.height,
        w: rect.width / box.width,
        h: rect.height / box.height,
      };

      if (!pageMap.has(pageNumber)) pageMap.set(pageNumber, []);
      pageMap.get(pageNumber)?.push(norm);
    });

    if (pageMap.size === 0) return null;

    const pagesArr: HighlightPage[] = Array.from(pageMap.entries()).map(
      ([page, rectsForPage]) => ({ page, rects: rectsForPage })
    );

    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      color,
      isFlashcard: color === "flashcard",
      text: selection.toString(),
      createdAt: new Date().toISOString(),
      pages: pagesArr,
    };
  }

  private scheduleRenderHighlights() {
    if (this.renderTimer) window.clearTimeout(this.renderTimer);
    this.renderTimer = window.setTimeout(() => {
      void this.renderHighlights();
    }, 150);
  }

  private async renderHighlights() {
    const pdfViewer = this.findPdfViewer();
    if (!pdfViewer) return;

    const file = this.getPdfFile();
    if (!file) return;

    const highlights = await this.plugin.loadHighlights(file.path);
    if (highlights.length === 0) return;

    const pageEls = Array.from(pdfViewer.querySelectorAll(".page")) as HTMLElement[];
    pageEls.forEach((pageEl) => {
      let layer = pageEl.querySelector(
        ".study-assist-highlight-layer"
      ) as HTMLDivElement | null;
      if (!layer) {
        layer = pageEl.createDiv({ cls: "study-assist-highlight-layer" });
      }
      layer.empty();

      const pageNumber = parseInt(pageEl.dataset.pageNumber ?? "1", 10) - 1;
      highlights.forEach((highlight) => {
        const page = highlight.pages.find((p) => p.page === pageNumber);
        if (!page) return;

        page.rects.forEach((rect) => {
          const hl = layer!.createDiv({ cls: "study-assist-highlight" });
          hl.style.left = `${rect.x * 100}%`;
          hl.style.top = `${rect.y * 100}%`;
          hl.style.width = `${rect.w * 100}%`;
          hl.style.height = `${rect.h * 100}%`;
          hl.style.background = COLOR_MAP[highlight.color];
          if (highlight.isFlashcard) hl.addClass("flashcard");
        });
      });
    });
  }
}

class PdfFlashcardsSettingTab extends PluginSettingTab {
  plugin: PdfFlashcardsPlugin;

  constructor(app: App, plugin: PdfFlashcardsPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("OpenAI API key")
      .setDesc("Stored locally in your Obsidian settings.")
      .addText((text) =>
        text
          .setPlaceholder("sk-...")
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Model")
      .setDesc("Default: gpt-5.1")
      .addText((text) =>
        text
          .setPlaceholder("gpt-5.1")
          .setValue(this.plugin.settings.model)
          .onChange(async (value) => {
            this.plugin.settings.model = value.trim() || "gpt-5.1";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Storage folder")
      .setDesc("Hidden folder for highlights, flashcards, and progress.")
      .addText((text) =>
        text
          .setPlaceholder(".flashcards")
          .setValue(this.plugin.settings.storageFolder)
          .onChange(async (value) => {
            this.plugin.settings.storageFolder = value.trim() || ".flashcards";
            await this.plugin.saveSettings();
          })
      );
  }
}

export default class PdfFlashcardsPlugin extends Plugin {
  settings: PluginSettings;
  private pdfControllers = new WeakMap<WorkspaceLeaf, PdfLeafController>();
  private progressCache?: ProgressFile;

  async onload() {
    await this.loadSettings();

    this.addSettingTab(new PdfFlashcardsSettingTab(this.app, this));

    this.registerView(FLASHCARD_VIEW_TYPE, (leaf) => new FlashcardView(leaf, this));
    this.registerView(FLASHCARD_MANAGE_VIEW_TYPE, (leaf) => new FlashcardManageView(leaf, this));

    this.addCommand({
      id: "study-assist-generate-flashcards",
      name: "Generate flashcards from PDF flashcard highlights",
      callback: () => void this.generateFlashcardsFromActivePdf(),
    });

    this.addCommand({
      id: "study-assist-open-flashcards",
      name: "Open flashcard study view",
      callback: () => void this.openFlashcardView(),
    });

    this.addCommand({
      id: "study-assist-manage-flashcards",
      name: "Open flashcard manager",
      callback: () => void this.openFlashcardManageView(),
    });

    this.addCommand({
      id: "study-assist-export-pdf-annotations",
      name: "Export current PDF annotations to markdown",
      callback: () => void this.exportAnnotationsFromActivePdf(),
    });

    this.addRibbonIcon("sparkles", "Generate Flashcards", () =>
      void this.generateFlashcardsFromActivePdf()
    );
    this.addRibbonIcon("dice-4", "Flashcards", () => void this.openFlashcardView());

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (!leaf) return;
        this.maybeAttachToPdfLeaf(leaf);
      })
    );

    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        this.app.workspace.iterateAllLeaves((leaf) => {
          this.maybeAttachToPdfLeaf(leaf);
        });
      })
    );

    this.app.workspace.iterateAllLeaves((leaf) => {
      this.maybeAttachToPdfLeaf(leaf);
    });
  }

  onunload() {
    this.pdfControllers = new WeakMap();
  }

  private maybeAttachToPdfLeaf(leaf: WorkspaceLeaf) {
    if ((this.app as any).isMobile) return;
    const viewType = (leaf.view as any).getViewType?.() ?? (leaf.view as any).viewType;
    if (viewType !== "pdf") return;
    const existing = this.pdfControllers.get(leaf);
    if (existing) {
      void existing.ensureAttached();
      return;
    }

    const controller = new PdfLeafController(this, leaf);
    this.pdfControllers.set(leaf, controller);
    void controller.init();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private async ensureStorageFolder(create: boolean): Promise<string> {
    const folder = this.settings.storageFolder || ".flashcards";
    const adapter = this.app.vault.adapter;
    const exists = await adapter.exists(folder);
    if (!exists && create) {
      await adapter.mkdir(folder);
    }
    return folder;
  }

  private highlightPathFor(sourcePath: string): string {
    const hash = this.hashString(sourcePath);
    return `${this.settings.storageFolder}/highlights-${hash}.json`;
  }

  private flashcardPath(): string {
    return `${this.settings.storageFolder}/flashcards.json`;
  }

  private progressPath(): string {
    return `${this.settings.storageFolder}/progress.json`;
  }

  async saveHighlight(sourcePath: string, highlight: Highlight) {
    await this.ensureStorageFolder(true);
    const path = this.highlightPathFor(sourcePath);
    const existing = await this.readJson<HighlightFile>(path, {
      version: HIGHLIGHT_VERSION,
      sourcePath,
      highlights: [],
    });

    existing.sourcePath = sourcePath;
    existing.highlights.push(highlight);
    await this.writeJson(path, existing);
  }

  async loadHighlights(sourcePath: string): Promise<Highlight[]> {
    await this.ensureStorageFolder(false);
    const path = this.highlightPathFor(sourcePath);
    const data = await this.readJson<HighlightFile>(path, {
      version: HIGHLIGHT_VERSION,
      sourcePath,
      highlights: [],
    });
    return data.highlights || [];
  }

  async loadAllCards(): Promise<Flashcard[]> {
    await this.ensureStorageFolder(false);
    const path = this.flashcardPath();
    const data = await this.readJson<FlashcardFile>(path, {
      version: FLASHCARD_VERSION,
      cards: [],
    });
    return data.cards || [];
  }

  async addCards(newCards: Flashcard[]) {
    await this.ensureStorageFolder(true);
    const path = this.flashcardPath();
    const data = await this.readJson<FlashcardFile>(path, {
      version: FLASHCARD_VERSION,
      cards: [],
    });
    data.cards.push(...newCards);
    await this.writeJson(path, data);
  }

  async replaceAllCards(cards: Flashcard[]) {
    await this.ensureStorageFolder(true);
    const path = this.flashcardPath();
    const data: FlashcardFile = { version: FLASHCARD_VERSION, cards };
    await this.writeJson(path, data);
    await this.pruneProgress(cards);
  }

  async updateProgress(cardId: string, isGood: boolean) {
    await this.updateProgressOptimistic(cardId, isGood);
  }

  async updateProgressOptimistic(cardId: string, isGood: boolean): Promise<CardProgress> {
    await this.ensureStorageFolder(true);
    const path = this.progressPath();
    const data =
      this.progressCache ??
      (await this.readJson<ProgressFile>(path, {
        version: PROGRESS_VERSION,
        progress: {},
      }));

    const current = this.buildNextProgress(data.progress[cardId], isGood);
    data.progress[cardId] = current;
    this.progressCache = data;
    void this.writeJson(path, data);
    return current;
  }

  private buildNextProgress(
    previous: CardProgress | undefined,
    isGood: boolean
  ): CardProgress {
    const now = new Date();
    const current: CardProgress = previous
      ? { ...previous }
      : {
          streak: 0,
          intervalDays: 0,
        };

    if (isGood) {
      current.streak += 1;
      current.intervalDays = Math.max(1, current.intervalDays + current.streak);
      current.done = true;
    } else {
      current.streak = 0;
      current.intervalDays = 0;
      current.done = false;
    }

    const nextDue = new Date(now.getTime());
    nextDue.setDate(now.getDate() + (isGood ? current.intervalDays : 0));

    current.lastReviewedAt = now.toISOString();
    current.nextDueAt = nextDue.toISOString();
    return current;
  }

  async loadProgress(): Promise<Record<string, CardProgress>> {
    await this.ensureStorageFolder(false);
    const path = this.progressPath();
    if (!this.progressCache) {
      this.progressCache = await this.readJson<ProgressFile>(path, {
        version: PROGRESS_VERSION,
        progress: {},
      });
    }
    return this.progressCache.progress ?? {};
  }

  async resetProgress() {
    await this.ensureStorageFolder(true);
    const path = this.progressPath();
    const data: ProgressFile = { version: PROGRESS_VERSION, progress: {} };
    await this.writeJson(path, data);
    this.progressCache = data;
  }

  async removeProgress(cardId: string) {
    await this.ensureStorageFolder(true);
    const path = this.progressPath();
    const data =
      this.progressCache ??
      (await this.readJson<ProgressFile>(path, {
        version: PROGRESS_VERSION,
        progress: {},
      }));
    delete data.progress[cardId];
    await this.writeJson(path, data);
    this.progressCache = data;
  }

  private async pruneProgress(cards: Flashcard[]) {
    const ids = new Set(cards.map((c) => c.id));
    const path = this.progressPath();
    const data =
      this.progressCache ??
      (await this.readJson<ProgressFile>(path, {
        version: PROGRESS_VERSION,
        progress: {},
      }));
    Object.keys(data.progress).forEach((id) => {
      if (!ids.has(id)) delete data.progress[id];
    });
    await this.writeJson(path, data);
    this.progressCache = data;
  }

  private async readJson<T>(path: string, fallback: T): Promise<T> {
    const adapter = this.app.vault.adapter;
    const exists = await adapter.exists(path);
    if (!exists) return fallback;
    try {
      const raw = await adapter.read(path);
      return Object.assign({}, fallback, JSON.parse(raw));
    } catch {
      return fallback;
    }
  }

  private async writeJson(path: string, data: unknown) {
    const adapter = this.app.vault.adapter;
    await adapter.write(path, JSON.stringify(data, null, 2));
  }

  private hashString(value: string): string {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash +=
        (hash << 1) +
        (hash << 4) +
        (hash << 7) +
        (hash << 8) +
        (hash << 24);
    }
    return (hash >>> 0).toString(16);
  }

  private getActivePdfFile(): TFile | null {
    const leaf = this.app.workspace.getMostRecentLeaf();
    if (!leaf) return null;
    const viewType = (leaf.view as any).getViewType?.() ?? (leaf.view as any).viewType;
    if (viewType !== "pdf") return null;
    const view: any = leaf.view as any;
    if (view?.file instanceof TFile) return view.file as TFile;
    return leaf.view?.file ?? null;
  }

  private async generateFlashcardsFromActivePdf() {
    const file = this.getActivePdfFile();
    if (!file) {
      new Notice("Open a PDF first.");
      return;
    }

    if (!this.settings.apiKey) {
      new Notice("Set your OpenAI API key in the plugin settings.");
      return;
    }

    const highlights = await this.loadHighlights(file.path);
    const flashcardHighlights = highlights.filter(
      (h) => h.isFlashcard && !h.flashcardGenerated
    );

    if (flashcardHighlights.length === 0) {
      new Notice("No new flashcard highlights found.");
      return;
    }

    const contextText = flashcardHighlights
      .map((h, idx) => `(${idx + 1}) ${h.text}`)
      .join("\n");

    const systemPrompt =
      "You are a helpful assistant that turns study highlights into flashcards.";
    const userPrompt =
      "Create concise flashcards from the following highlights. " +
      "Return a JSON array where each item has 'question' and 'answer'. " +
      "Avoid markdown, and keep questions short and clear.\n\n" +
      contextText;

    try {
      const response = await this.callOpenAI(systemPrompt, userPrompt);
      const cards = this.parseFlashcards(response);
      if (cards.length === 0) {
        new Notice("No flashcards returned by the model.");
        return;
      }

      const now = new Date().toISOString();
      const newCards: Flashcard[] = cards.map((card) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        sourcePath: file.path,
        highlightIds: flashcardHighlights.map((h) => h.id),
        question: card.question,
        answer: card.answer,
        createdAt: now,
      }));

      await this.addCards(newCards);
      await this.markHighlightsGenerated(file.path, flashcardHighlights.map((h) => h.id));
      new Notice(`Generated ${newCards.length} flashcards.`);
      await this.refreshFlashcardView();
      await this.refreshFlashcardManageView();
    } catch (err) {
      console.error(err);
      new Notice("Failed to generate flashcards.");
    }
  }

  private async markHighlightsGenerated(sourcePath: string, highlightIds: string[]) {
    await this.ensureStorageFolder(true);
    const path = this.highlightPathFor(sourcePath);
    const existing = await this.readJson<HighlightFile>(path, {
      version: HIGHLIGHT_VERSION,
      sourcePath,
      highlights: [],
    });
    const idSet = new Set(highlightIds);
    existing.highlights = existing.highlights.map((h) =>
      idSet.has(h.id) ? { ...h, flashcardGenerated: true } : h
    );
    await this.writeJson(path, existing);
  }

  private async callOpenAI(systemPrompt: string, userPrompt: string): Promise<string> {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.settings.apiKey}`,
      },
      body: JSON.stringify({
        model: this.settings.model || "gpt-5.1",
        instructions: systemPrompt,
        input: userPrompt,
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${errorText}`);
    }

    const data = await response.json();
    return this.extractOutputText(data);
  }

  private extractOutputText(data: any): string {
    if (data.output_text && typeof data.output_text === "string") {
      return data.output_text;
    }

    if (Array.isArray(data.output)) {
      for (const item of data.output) {
        if (item?.type === "message" && Array.isArray(item?.content)) {
          const textPart = item.content.find(
            (content: any) => content.type === "output_text" || content.type === "text"
          );
          if (textPart?.text) return textPart.text as string;
        }
      }
    }

    if (data?.content && typeof data.content === "string") return data.content;
    return "";
  }

  private parseFlashcards(raw: string): { question: string; answer: string }[] {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((item) => item?.question && item?.answer)
        .map((item) => ({
          question: String(item.question),
          answer: String(item.answer),
        }));
    } catch {
      return [];
    }
  }

  private async openFlashcardView() {
    let leaf = this.app.workspace.getLeavesOfType(FLASHCARD_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false);
      await leaf.setViewState({
        type: FLASHCARD_VIEW_TYPE,
        active: true,
      });
    } else {
      this.app.workspace.revealLeaf(leaf);
    }
  }

  private async openFlashcardManageView() {
    let leaf = this.app.workspace.getLeavesOfType(FLASHCARD_MANAGE_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false);
      await leaf.setViewState({
        type: FLASHCARD_MANAGE_VIEW_TYPE,
        active: true,
      });
    } else {
      this.app.workspace.revealLeaf(leaf);
    }
  }

  private async refreshFlashcardView() {
    const leaves = this.app.workspace.getLeavesOfType(FLASHCARD_VIEW_TYPE);
    if (leaves.length === 0) return;
    for (const leaf of leaves) {
      const view = leaf.view as FlashcardView;
      if ((view as any)?.refresh) {
        await (view as any).refresh();
      }
    }
  }

  private async refreshFlashcardManageView() {
    const leaves = this.app.workspace.getLeavesOfType(FLASHCARD_MANAGE_VIEW_TYPE);
    if (leaves.length === 0) return;
    for (const leaf of leaves) {
      const view = leaf.view as FlashcardManageView;
      if ((view as any)?.refresh) {
        await (view as any).refresh();
      }
    }
  }

  private getAnnotationMarkdownPath(file: TFile): string {
    const baseName = `${file.basename} Annotations.md`;
    const parentPath = file.parent?.path ?? "";
    return parentPath ? `${parentPath}/${baseName}` : baseName;
  }

  private buildAnnotationMarkdown(file: TFile, highlights: Highlight[]): string {
    const lines: string[] = [];
    if (highlights.length === 0) {
      lines.push("_No annotations found._");
      return lines.join("\n");
    }

    const order: HighlightColor[] = ["flashcard", "yellow", "green", "blue"];
    const groups = new Map<HighlightColor, Highlight[]>();
    highlights.forEach((highlight) => {
      const list = groups.get(highlight.color) ?? [];
      list.push(highlight);
      groups.set(highlight.color, list);
    });

    const titleForColor = (color: HighlightColor) => {
      if (color === "flashcard") return "Flashcard";
      return color.charAt(0).toUpperCase() + color.slice(1);
    };

    order.forEach((color) => {
      const list = groups.get(color);
      if (!list || list.length === 0) return;
      lines.push(`## ${titleForColor(color)}`);
      list.forEach((highlight) => {
        const text = highlight.text.replace(/\s+/g, " ").trim();
        const pages = Array.from(
          new Set(highlight.pages.map((p) => p.page + 1))
        ).sort((a, b) => a - b);
        const pageInfo = pages.length ? ` (pages ${pages.join(", ")})` : "";
        lines.push(`- ${text}${pageInfo}`);
      });
      lines.push("");
    });

    return lines.join("\n").trimEnd() + "\n";
  }

  private async exportAnnotationsFromActivePdf() {
    const file = this.getActivePdfFile();
    if (!file) return;

    const highlights = await this.loadHighlights(file.path);
    const content = this.buildAnnotationMarkdown(file, highlights);
    const path = this.getAnnotationMarkdownPath(file);
    const existing = this.app.vault.getAbstractFileByPath(path);

    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, content);
    } else {
      await this.app.vault.create(path, content);
    }
  }
}
