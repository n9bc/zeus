# Local note — in-app update check disabled

**Date:** 2026-09-20  
**Where:** `Zeus.Server.Hosting/RepoUpdateService.cs` (`GetStatusAsync`)

Unsigned local Mac DMGs stamp `InformationalVersion` as `1.85-dev` (see
`Directory.Build.props`: `VersionSuffix=dev` unless `GITHUB_REF_TYPE=tag`).
The fork's `latest.json` reports `1.85`. `IsManifestNewer` treats the same
numeric prefix with a different suffix as a newer rolling build, so startup
offered an update for the version already running. The published v1.85
assets are Linux AppImages only, so applying that offer would not replace
the Mac app.

Update checking (network fetch + `UpdateAvailable` / `ForceUpdate`) is
turned off in `GetStatusAsync` until someone restores the original fetch
path. Settings → Updates will show the installed version only, not a
download prompt.
