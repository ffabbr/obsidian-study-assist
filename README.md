# PDF Flashcards

Create AI flashcards from PDF highlights inside Obsidian.

## Features
- Highlight text in PDFs with color-coded pens, including a dedicated flashcard pen.
- Generate flashcards from flashcard highlights using OpenAI.
- Study flashcards in a built-in review view with spaced repetition.
- Export all PDF annotations to a markdown file grouped by color.

## How To Use
1. Open a PDF in Obsidian.
2. Select text and click a color button in the PDF toolbar to create a highlight.
3. For flashcards, use the **Flashcard** color.
4. Run **"Generate flashcards from PDF flashcard highlights"** from the command palette.
5. Study with **"Open flashcard study view"**.
6. Export annotations with **"Export current PDF annotations to markdown"**.

## Settings
- **OpenAI API key**: required for flashcard generation.
- **Model**: defaults to `gpt-5.1`.
- **Storage folder**: where highlights, flashcards, and progress are stored (default: `.flashcards`).

## Installation
Install from the Obsidian Community Plugins browser once the plugin is published.

## Development
- `npm install`
- `npm run dev`

## License
MIT
