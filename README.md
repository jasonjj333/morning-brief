# Morning Brief

A mobile-first reader for an Obsidian vault kept in a private GitHub repo. It shows the daily brief,
action items, upcoming events and meeting notes, and sends feedback back to the vault as
`Feedback/inbox.json`, which a scheduled Claude routine applies each weekday at 7:00 AM Central.

This repo holds only the app. No notes are stored here: the page reads the private vault at runtime
with a fine-grained GitHub token the user pastes into Settings, kept in that browser's localStorage.

## Local preview

```
node dev/serve.mjs /path/to/a/copy/of/the/vault 4173
```

Then open http://localhost:4173/?dev. Writes go to that copy, never to GitHub.
