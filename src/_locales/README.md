# Localization Guidelines

## Key Naming Convention
- Use dot notation for keys to organize by section and feature.
  - Example keys:
    - `videos.list.title`
    - `videos.list.delete`
    - `playlist.list.title`
    - `playlist.card.title`
    - `statistics.top_channels.title`
- Each key should have a clear `description` for translators.

## Adding a New Translation
1. **Always start from the English (`en/messages.json`) file.**
   - Copy all keys and descriptions from `en/messages.json` to your new language file (e.g., `fr/messages.json`).
   - Translate only the `message` values, not the keys or descriptions.
2. Place your new language folder (e.g., `fr`) inside `_locales`.
3. Ensure your JSON is valid (no comments, proper structure).

## Example Structure
```
_locales/
  en/
    messages.json
  bg/
    messages.json
  fr/
    messages.json
  ...
```

## Notes
- Do **not** add comments to `messages.json` files (JSON does not support comments).
- Use the `description` field for any translator notes or clarifications. 