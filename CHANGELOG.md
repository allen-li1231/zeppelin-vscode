# Change Log

All notable changes to the "zeppelin-vscode" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

- Initial release

## [0.1.1] - 2023-7-18

### Addded
- Settings related to specifying or selecting an existing Zeppelin server.
- Useful commands in command palette.
- Make notebook read-only when not connected to a server.
- user can either unlock file using command or by instructions in a window poped up when it is opened.
- User will be prompted to provide notebook save path if the current notebook does not exists on the server.
- Autosave with syncing to server every 5 seconds by default (configurable in setting).

### Fixed
- Various API connection problems and login status caching problems.
- Jupyter notebook can be imported to a Zeppelin server after 0.10.0 using command.
- Pictures, HTMLs can now be rendered in cell outputs, **need user to tweak output presentation to see different types of outputs**.
- Bug in getting and updating workspace settings during extension run.

### Changed
- Refactor serialization and deserializaion code to increase reusability.


## [0.1.2] - 2023-7-19

### Added
- Configurability to automatically connect to last-used server without asking user.
- Enrich settings description.

### Fixed
- Compatibility issue related to listNotes Zeppelin API before 0.10.0.

### Changed
- Present a better extension name. Due to this change, the extension was republished.
- Reorder and group settings.
- Update VS Code version requirement, and use esbuild to speed up builds.

### Removed
- Unused npm package in package.json.


## [0.1.3] - 2023-7-21

### Added
- Kernel now can be selected by clicking on current kernel, and display names of list of kernels become user-friendly.

### Fixed
- Bug that causes API service and kernel display name not responding to user switching Zeppelin server.
- Bug that causes first-time opening a notebook doesn't trigger login procedure after user has provided Zeppelin server URL.


## [0.1.4] - 2023-7-25

### Fixed
- Bug that causes changing server credentials doesn't trigger a new login.


## [0.1.5] - 2023-9-21

### Added
- Line number toggling command, and automatically synced to server (still buggy when toggling all cells' line numbers, the problem lies in VSCode api provided)

### Enhancement
- Allow api error message to emit using vscode.window.showErrorMessage.
- Comments enrichment.

### Fixed
- Bug that causes imported note's path not correctly set.
- Following bugs in promptCreateNotebook:
    > Quickpick tiggers not fully disposed.
    > Selectable note save path not shown correctly.
    > Note base name not appended to save path as expected.