# Change Log

All notable changes to the "zeppelin-vscode" extension will be documented in this file.

## [0.1.1] - 2023-07-18

### Added
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


## [0.1.2] - 2023-07-19

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


## [0.1.3] - 2023-07-21

### Added
- Kernel now can be selected by clicking on current kernel, and display names of list of kernels become user-friendly.

### Fixed
- Bug that causes API service and kernel display name not responding to user switching Zeppelin server.
- Bug that causes first-time opening a notebook doesn't trigger login procedure after user has provided Zeppelin server URL.


## [0.1.4] - 2023-07-25

### Fixed
- Bug that causes changing server credentials doesn't trigger a new login.


## [0.1.5] - 2023-09-21

### Added
- Line number toggling command, and automatically synced to server (still buggy when toggling all cells' line numbers, the problem lies in VSCode api provided)

### Enhancement
- Allow api error message to emit using vscode.window.showErrorMessage.
- Comments enrichment.

### Fixed
- Bug that causes imported note's path not correctly set.
- Following bugs in promptCreateNotebook:
> 1. Quickpick tiggers not fully disposed.
> 2. Selectable note save path not shown correctly.
> 3. Note base name not appended to save path as expected.


## [0.1.6] - 2023-11-27

### Enhancement
- url history records can be deleted manually.
- Decrease default paragraph update delay throttle time from 5 seconds to 1 second.
- Network issues are enabled to be emitted to vscode.window.


## [0.1.7] - 2023-11-27

### Fixed
- Prompting Zeppelin credentials not working properly.


## [0.2.0] - 2024-01-25

### Added
- Notebook cells now can run in parallel, and user can toggle run mode, either in parallel or sequential, in settings.
- Previously local notebook changes will be periodically updated to server, but not vice versa. Now notebook can be updated to its server version whenever it is opened or corresponding window is activated.

### Fixed
- [Missing proxy credential protocol setting.](https://github.com/allen-li1231/zeppelin-vscode/commit/fa5ad8ea58ba24a1eaec41c570aa0d9027a79973)
- [Bug that causes code interrupt to fail the extension.](https://github.com/allen-li1231/zeppelin-vscode/commit/692d1576e2318e177051d3f1e92ee3512bc8e007).
- [Bug that causes extension to fail when interrupting note.](https://github.com/allen-li1231/zeppelin-vscode/commit/96cda9e66ba079711458cafcb5528ec482a52c7b).
- [Bug that causes tracking on cell execution to be falsely ended when paragraph run status is pending.](https://github.com/allen-li1231/zeppelin-vscode/commit/f61c9e9b493e2ec7d307780ad7d3aef4daf7a54a).
- [Bug that causes error output when execution an empty cell.](https://github.com/allen-li1231/zeppelin-vscode/commit/8ad8d3b0b97c4b7f0b63f84c6dc97eddcc88684d)

### Changed
- [Remove locking zpln files as it causes misunderstanding and potentially causes problem when multiple notebooks are opened.](https://github.com/allen-li1231/zeppelin-vscode/commit/b214b94301bfcf1699eb3f7fc6adfc31c0dcd29e)


## [0.2.1] - 2024-01-26

### Fixed
- [Bug that causes multiple executions not properly interrupted.](https://github.com/allen-li1231/zeppelin-vscode/commit/8245c17ac6a332c12fd4aac2c093bd4518227baf)
- [Bug that causes sequential executions run in parallel when they are submitted one by one.](https://github.com/allen-li1231/zeppelin-vscode/commit/f2ebf6966ed7ab853ccf3d1cbc05111eb3de4bf7)


## [0.2.3] - 2024-02-12

### Added:
- Cell level progressbar, resolved issue #4 with pull request #5.


## [0.2.4] - 2024-02-14

### Fix:
- Removed dirty code that causes cell execution to fail.


## [0.2.5] - 2024-03-27

### Added:
- [Interpreter status and restart button on cell status bar.](https://github.com/allen-li1231/zeppelin-vscode/commit/ac9ffd3691682ae8ed118b521d9b2913af53adf0)

### Fixed:
- [Supported language abbreviation mismatch.](https://github.com/allen-li1231/zeppelin-vscode/commit/bfa0ec808c9114efd435bfbdcddde9134e40df6f)
### Changed:
- [Slightly slow down the speed to sync with the server.](https://github.com/allen-li1231/zeppelin-vscode/commit/35dcd183ba99dad0cc8d231e62bbedfb694783a6)

### Enhancement:
- [Simplify zeppelin warning on no credentials.](https://github.com/allen-li1231/zeppelin-vscode/commit/9781550748a2d51e3c5ff94481074efa838e4f23)


## [0.2.6] - 2024-03-28

### Added:
- Cell sync indicator at the cell status bar.

### Fixed:
- [Problem in language support that causes languages not understood by serializer.](https://github.com/allen-li1231/zeppelin-vscode/commit/6da028c0316a8796d7350760f93b857f690ef299)
- [Bug that causes extension to fail when deleting an executing cell.](https://github.com/allen-li1231/zeppelin-vscode/commit/f3a45b1e8072bcaae2a10c93a8bcc936d31f2a73)
- [Sync problem when creating a paragraph for a cell that does not exist on remote.](https://github.com/allen-li1231/zeppelin-vscode/commit/d484b5ae445deb04d1aa4c156385f801b7384914) 

### Changed
- [Remove 404 window error message, put the same message to cell status bar.](https://github.com/allen-li1231/zeppelin-vscode/commit/bad221c8e79bf8600e26f0ab16ec6e66a65f7d31)


## [0.2.7] - 2024-03-29

### Fixed:
- Fatal error when cell executions gets called end before started.
- Fatal sync error when remote running paragraph gets deleted.