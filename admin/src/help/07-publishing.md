# Publishing & deploy

## Saving is separate from publishing

Saving stores your work in the site's shared draft version. Posts and pages autosave;
other settings have their own Save controls. Saved work is not automatically live.

Each entry has a **Draft / Ready** toggle:

- **Draft** entries remain hidden from the production build.
- **Ready** entries are included the next time the owner publishes.

Translations can be marked Ready independently.

## Review, then publish

Open **Waiting to publish** to inspect the pending content and site changes. Open
**Publish** when you are ready to release them.

Publishing merges the shared draft version into production. It releases all pending
changes together, including changes to existing Ready entries and site settings.
There is no per-entry publish action yet.

The host then rebuilds the site. A successful publish request starts that process;
it does not prove the new version is already live. A failed build leaves the previous
version online. Check the deployment result if your changes do not appear.

## If publishing fails

The CMS displays the failure. A merge conflict needs to be resolved before retrying.
A save conflict in the editor pauses autosave and preserves your working text rather
than overwriting someone else's changes.
