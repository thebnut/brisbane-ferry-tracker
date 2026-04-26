# TransLink Data Attribution

Brisbane Ferry Tracker uses GTFS and GTFS-RT data published by the State of Queensland (Department of Transport and Main Roads) via TransLink. This data is licensed under the [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/) licence.

## Recommended Attribution Text

Use the following attribution wherever the data is displayed to end users:

> Based on data provided by the State of Queensland (Department of Transport and Main Roads) — licensed under [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).

### Web Attribution (HTML)

```html
<p>
  Based on data provided by the State of Queensland
  (Department of Transport and Main Roads) —
  licensed under
  <a href="https://creativecommons.org/licenses/by/4.0/"
     target="_blank" rel="noopener noreferrer">
    Creative Commons Attribution 4.0
  </a>.
</p>
```

In this project the attribution text lives in `src/utils/constants.js` as the `ATTRIBUTION` export, so it can be reused across components without duplication.

### Mobile App Attribution

For native or hybrid mobile apps, place the attribution in an **About** or **Credits** screen that is reachable from the main navigation:

```
Data Attribution
────────────────
Based on data provided by the State of Queensland
(Department of Transport and Main Roads).

Licensed under Creative Commons Attribution 4.0
https://creativecommons.org/licenses/by/4.0/
```

If screen space is limited (e.g. a widget), a short form such as "Data: Qld Dept of Transport and Main Roads (CC BY 4.0)" is acceptable as long as the full attribution is accessible elsewhere in the app.

### Repository / README Attribution

Include the following in your README's Acknowledgments or Data Sources section:

```markdown
Schedule and real-time transit data is sourced from
[TransLink SEQ GTFS feed](https://www.data.qld.gov.au/),
published by the State of Queensland (Department of Transport and Main Roads)
under a [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/) licence.
```

## Implementation Notes

- The CC BY 4.0 licence requires attribution but does not restrict commercial use.
- Attribution must be visible to end users, not only in source code.
- If you modify or adapt the data, you should indicate that changes were made (the standard wording "Based on data provided by..." satisfies this).
- The licence URL should be a clickable link in any medium that supports hyperlinks.
