# CJC Website

Static preview/export of the CJC Church website.

## Local Preview

Run the preview server with:

```bash
PORT=5173 node server.mjs
```

Then open:

```text
http://localhost:5173/index.html
```

The YouTube livestream and sermon sections can use `YOUTUBE_API_KEY` when available, and otherwise fall back to public YouTube channel data.
