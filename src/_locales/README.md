# Localization Guidelines

## Key Naming Convention
- Use only underscores (`_`) to separate words in keys. Do **not** use dots or dashes.
  - Example keys:
    - `videos_list_title`
    - `videos_list_delete`
    - `playlist_list_title`
    - `playlist_card_title`
    - `statistics_top_channels_title`
- Each key should have a clear `description` for translators.

## Adding a New Translation
1. **Always start from the English (`en/`) files.**
   - Copy all keys and descriptions from each English file (`messages.json`, `messages-group.json`, `tabs.json`, `settings.json`) to your new language folder (e.g., `fr/`).
   - Translate only the `message` values, not the keys or descriptions, in each file.
2. Place your new language folder (e.g., `fr`) inside `_locales`.
3. Ensure your JSON is valid (no comments, proper structure) in all files.

## Example Structure
```
_locales/
  en/
    messages.json
    messages-group.json
    tabs.json
    settings.json
  bg/
    messages.json
    messages-group.json
    tabs.json
    settings.json
  fr/
    messages.json
    messages-group.json
    tabs.json
    settings.json
  ...
```

## Notes
- Do **not** add comments to `messages.json` files (JSON does not support comments).
- Use the `description` field for any translator notes or clarifications.

## Translation Guidelines
- All message keys must use only ASCII letters, numbers, and underscores (`[a-zA-Z0-9_]`). Do not use dots or dashes in keys.
- Non-English translations are currently machine-generated. If you are a native speaker, your improvements are welcome!
- To add or improve a translation, edit the relevant file in this folder and submit a pull request. 