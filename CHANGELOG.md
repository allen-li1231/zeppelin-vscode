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

### Added
- Cell level progressbar, resolved issue #4 with pull request #5.


## [0.2.4] - 2024-02-14

### Fixed
- Removed dirty code that causes cell execution to fail.


## [0.2.5] - 2024-03-27

### Added
- [Interpreter status and restart button on cell status bar.](https://github.com/allen-li1231/zeppelin-vscode/commit/ac9ffd3691682ae8ed118b521d9b2913af53adf0)

### Fixed
- [Supported language abbreviation mismatch.](https://github.com/allen-li1231/zeppelin-vscode/commit/bfa0ec808c9114efd435bfbdcddde9134e40df6f)
### Changed
- [Slightly slow down the speed to sync with the server.](https://github.com/allen-li1231/zeppelin-vscode/commit/35dcd183ba99dad0cc8d231e62bbedfb694783a6)

### Enhancement
- [Simplify zeppelin warning on no credentials.](https://github.com/allen-li1231/zeppelin-vscode/commit/9781550748a2d51e3c5ff94481074efa838e4f23)


## [0.2.6] - 2024-03-28

### Added
- Cell sync indicator at the cell status bar.

### Fixed
- [Problem in language support that causes languages not understood by serializer.](https://github.com/allen-li1231/zeppelin-vscode/commit/6da028c0316a8796d7350760f93b857f690ef299)
- [Bug that causes extension to fail when deleting an executing cell.](https://github.com/allen-li1231/zeppelin-vscode/commit/f3a45b1e8072bcaae2a10c93a8bcc936d31f2a73)
- [Sync problem when creating a paragraph for a cell that does not exist on remote.](https://github.com/allen-li1231/zeppelin-vscode/commit/d484b5ae445deb04d1aa4c156385f801b7384914) 

### Changed
- [Remove 404 window error message, put the same message to cell status bar.](https://github.com/allen-li1231/zeppelin-vscode/commit/bad221c8e79bf8600e26f0ab16ec6e66a65f7d31)


## [0.2.7] - 2024-03-29

### Fixed
- Fatal error when cell executions gets called end before started.
- Fatal sync error when remote running paragraph gets deleted.


## [0.2.8] - 2024-04-09

### Fixed
- #11 
- [Execution ending error when notebook is repeatedly opened quickly](https://github.com/allen-li1231/zeppelin-vscode/commit/08b032b1e9c92934a177d1da4403f65c65361f30)


## [0.2.9] - 2024-11-29

### Fixed
- [Misalignment of cell index through moving/copying/cutting and pasting cell.](https://github.com/allen-li1231/zeppelin-vscode/commit/198b53e936b7909567c048aec3b4cbfcfc8d45c8)
- [Inappropriate create new file prompt when comparing file history in git](https://github.com/allen-li1231/zeppelin-vscode/commit/969b39776209ee55ef3cdefe96bd169836405110)


## [0.2.10] - 2025-01-03

### Added
[HTTP Agent Configuration support](https://github.com/allen-li1231/zeppelin-vscode/commit/f44dd57b0606cd1b5b654e31c9bdf7e059b86269) for resolving #15 .


## [0.2.11] - 2025-01-04

### Fixed
[Add missed parameter (rejectUnauthorized) in https agent](https://github.com/allen-li1231/zeppelin-vscode/commit/6acebf2f56ab10d208b3d34dcb4c09bab3f368d0).


## [0.2.12] - 2025-01-14

### Fixed
- Wrong password even if provided correctly for [#15].
- Zeppelin credentials not prompted as expected when Zeppelin notebook is not opened.


## [0.2.13] - 2025-01-26

### Added
- In response to #19, [allow disabling automatically loading proxy settings from `http_proxy`, `https_proxy` and `no_proxy` environment variables in extension setting for #19 ](https://github.com/allen-li1231/zeppelin-vscode/commit/c549652dd4c6a52d9d2ed4c64af5b092374bf100).

### Enhancement
- Move some settings with default values into `settings.json` file to silent warnings.


## [0.2.14] - 2025-01-29

### Fixed
- [Loading environment variables behavior not following the setting](https://github.com/allen-li1231/zeppelin-vscode/commit/21ee17c5ad1dbd56c9bacd40866b53f03b1e65b5) in response to #19.
- [Newly added cell's text not being synced at all.](https://github.com/allen-li1231/zeppelin-vscode/commit/9c0c96843b35e8aaca3d0616072383f6aa78736a)
- [Previously removed cell causing the out-of-bound error.](https://github.com/allen-li1231/zeppelin-vscode/commit/b2de5349908103ce1c5c4e70554b033795007a64)
- [Make cell error outputs use stderr output](https://github.com/allen-li1231/zeppelin-vscode/commit/95e834b6f2068aaa8e58f5a9a71fe48872e573e4)  in response to #21.
- [Make instant cell update earlier to silent prompting creating paragraph.](https://github.com/allen-li1231/zeppelin-vscode/commit/9ed56667449441229cf55b4baa9226ee87f43e90)


## [0.2.15] - 2025-07-28

### Fixed
- Notebook cells get deleted from replacement triggered by repeated syncNote in response to #24.


## [0.2.16] - 2025-08-28

### Fixed
- [Failure of retrieving interpreter settings causes extension to stop working](https://github.com/allen-li1231/zeppelin-vscode/commit/5c967ae81771d83c84f9f160b77110d16b95a069) in response to #26.

### Enhancement
- [Use sequential cell execution by default (was in parallel)](https://github.com/allen-li1231/zeppelin-vscode/commit/d5050d575a1c4d92a6826b04e1ddd9891fa0abbd) in response to #23.
- [Minor debug information improvements](https://github.com/allen-li1231/zeppelin-vscode/commit/9ad38213199848b5fd4cae43f8bbbb9993b41f55).


## [0.2.17] - 2025-08-29

### Fixed
- [Racing condition in instant paragraph update](https://github.com/allen-li1231/zeppelin-vscode/commit/9ef6edba4eecd2982b482473c0ce067e8d04b7e9) in response to #26.

### Enhancement
- [Enrich debug logging](https://github.com/allen-li1231/zeppelin-vscode/commit/fd9de0fb243ce3ee782bcc02ad0b205e0dd734d4).
- [Add http timeout setting](https://github.com/allen-li1231/zeppelin-vscode/commit/154a0b6f1298888815c8200bdf45fdee4f833b71).
- [Improve interpreter status update strategy](https://github.com/allen-li1231/zeppelin-vscode/commit/780443aeb2a033bfb17f135aba93e960fc016ec0).


## [0.2.18] - 2025-09-07

### Fixed
- [Fix bug that caused revisions in notebook get reverted](https://github.com/allen-li1231/zeppelin-vscode/commit/95e882dc58dc06da4e36480acb1b58b2d37b50af) in response to #29.
- [Cell output not cleared when execution starts](https://github.com/allen-li1231/zeppelin-vscode/commit/0676c76cf5fc4d27642dececd64c6f4a3e83e398) in response to #30.
- [Fix 'index out of bound' error when adding multiple cells in a high frequency](https://github.com/allen-li1231/zeppelin-vscode/commit/059a8d357da9f6331da11fe96ba35c6f4e437326).
- [Leaking cell status bar item](https://github.com/allen-li1231/zeppelin-vscode/commit/92259c36fb90a00107fa35ffcd7144d675465d03).
- [Fix paragraph deletion error when syncing notebook](https://github.com/allen-li1231/zeppelin-vscode/commit/13c939005882d89637d9e74b109b262c3fc68cce).

### Enhancement
- [New cell execution policy: 'by interpreter' dispatches executions to corresponding interpreter, with concurrency determined by interpreter setting on Zeppelin server](https://github.com/allen-li1231/zeppelin-vscode/commit/c642d8e89a7378877a322be11abfa7a4d7ca2e82), hopefully resolving #29.
- [Improve creating paragraph prompt message](https://github.com/allen-li1231/zeppelin-vscode/commit/af8d9271d1cd15c95f2a57f73aaa1b663c036f60).
- [Remove duplicated update operation during cell status bar updating](https://github.com/allen-li1231/zeppelin-vscode/commit/ee92a20827263993fab3d764eb134265984382ca).



## [0.2.19] - 2026-06-05

### Fixed
- `updateByReplaceCell` permanently disabling autosave due to `_flagRegisterParagraphUpdate` incorrectly set to `false` instead of `true` after cell replacement.
- `_doUpdatePollingParagraphs` not awaiting `updateParagraph` calls, causing concurrent fire-and-forget updates and stale state in subsequent cell status bar refresh.
- `doUpdateVisibleCells` in `CellStatusProvider` not awaiting `editWithoutParagraphUpdate`, allowing `_flagRegisterParagraphUpdate` to interleave with other callers.
- `doUpdateVisibleCells` calling `applyPolledNotebookEdits` per visible range instead of once after all ranges, and without `await`, causing polled edits queued during the loop to be missed.
- `onWillSaveNotebookDocument` handler not using `event.waitUntil()`, allowing the notebook to be saved before pending paragraph updates and polled edits are flushed.
- `unregisterParagraphUpdate` accessing `_mapUpdateParagraph` without `_updateMutex` protection; now uses mutex-guarded public method (with a direct internal variant for callers already holding the lock).
- `CellStatusProvider._timerUpdateCellStatus` interval never disposed: timer started unconditionally in constructor and neither `ZeppelinKernel.deactivate()` nor extension deactivation called `dispose()`, causing the interpreter-status polling loop to leak indefinitely. Now the timer follows `scheduleTracking()`/`unscheduleTracking()` lifecycle, is stopped in `deactivate()`, and the provider is registered as a disposable in `context.subscriptions`.
- `CellStatusProvider.doUpdateAllInterpreterStatus` non-atomic map update: `_mapInterpreterStatus` was cleared then repopulated one-by-one inside the mutex, allowing `provideCellStatusBarItems()` (which runs outside the mutex) to observe an empty or partially-populated map. Now builds a new `Map` locally and swaps atomically.
- `CellStatusProvider._cellStatusUpdateMutex` TOCTOU guard: the `isLocked()` check before `runExclusive()` could theoretically allow duplicate entries if the method is called from multiple sites. Replaced with a synchronous `_isUpdatingStatus` flag set before any async gap and cleared in `finally`.

### Added
- [Paragraph info cache (`zeppelin.paragraphCache.refreshInterval` setting, default 5 seconds). A background interval (`_doRefreshParagraphCache`) pre-fetches paragraph info for visible cells and stores results in `_mapParagraphCache`. `getParagraphInfo` returns cached data when fresh (within the configured TTL), eliminating redundant network calls from `trackExecution`, `_doExecutionAsync`, and `doUpdateVisibleCells`](cde00c5dd67fc495c111c7b34fbf8c1a6a2a5beb).
- [404 sentinel caching: when a paragraph doesn't exist on the server, the cache stores a `null` sentinel so that subsequent `getParagraphInfo` calls within the TTL silently return cell metadata with `status: 404` instead of repeatedly triggering `promptCreateParagraph` dialogs](cde00c5dd67fc495c111c7b34fbf8c1a6a2a5beb).

### Enhancement
- Mirgrate to Typescript 6 in accordance to: https://aka.ms/ts6
- [Anonymous login as default approach if Zeppelin credential is not given](https://github.com/allen-li1231/zeppelin-vscode/commit/2e652f35a704bf043bb9823864c768a1e6dbbd6b) in response to #34.



## [0.2.20] - 2026-06-11

### Added
- [Sync conflict resolution workflow](https://github.com/allen-li1231/zeppelin-vscode/commit/21bf06e66e1fac6bee16bed70501bea18d173366): When a cell differs from the server, the status bar now shows three buttons — "Remote Changed" (opens diff view), "Accept Remote" (replaces local with server version), and "Keep Local" (pushes local version to server).
- `resolvingDiff` metadata flag: Opening the diff view marks the cell as "resolving". While in this state:
  - Local changes are **not pushed** to the server (paragraph updates are blocked).
  - [The cell **cannot be executed**](refrain diff-detected cells from execution) (a warning message is shown instead).
  - `syncNote` **preserves** the conflict markers so they survive notebook re-focus.
- [Interrupt handler for paragraph execution](https://github.com/allen-li1231/zeppelin-vscode/commit/08707aca46113e9870549580deceb17aad7808b4).
- New command `zeppelin-vscode.acceptLocalCell`: accepts the local version and pushes it to the server, clearing all conflict flags.
- [Test suite for extension development](https://github.com/allen-li1231/zeppelin-vscode/commit/cc9cbe5f83ef0ca5ff183a7e07719178fd3c3585).

### Fixed
- [Local cell text silently overwriting the remote version when saving or the user was still reviewing a diff](https://github.com/allen-li1231/zeppelin-vscode/commit/049fbbe21d892aecfb3dc34f17c5a634cd22ecef).

### Enhancement
- [Refactor syncNote from destructive replace to merge](https://github.com/allen-li1231/zeppelin-vscode/commit/079cbb74dc564ebd3d74f37aed4eaf2062d95003).



## [0.2.21] - 2026-06-12

### Added
- [Local git support](https://github.com/allen-li1231/zeppelin-vscode/commit/1c73aa6e4844ae076d7c997e769b980b7d6294b9).

### Fixed
- [Bug that causes Remote Changes buttons to show up when a notebook is edited and quickly switched away then back](https://github.com/allen-li1231/zeppelin-vscode/commit/4299ab6ba67720e0596631a0f82fca224701ba37).



## [0.2.22] - 2026-06-15

### Fixed
- Wrong notebook cell assertion that causes syncing problems.



## [0.2.23] - 2026-06-16

### Fixed
- [False "Remote Changed" sync conflict detection triggered by `syncNote`](https://github.com/allen-li1231/zeppelin-vscode/commit/f65870cd182560a598f6ec178cc89b6079f2523c).
- [False "Remote Changed" sync conflict detection on markdown cells caused by `_updateParagraph` firing `runParagraph` without `await`](https://github.com/allen-li1231/zeppelin-vscode/commit/8416f970aeb514b6750cde43da15a4522891c78c), leading to stale local results vs updated server results on the next sync poll.
- ["Sync pending" status indicator never clearing for newly added markdown cells](https://github.com/allen-li1231/zeppelin-vscode/commit/f34988b2a5bd7a805a1e0824518cab550db3e6f7): polled metadata updates (including `status`) from `doUpdateVisibleCells` were queued but never flushed because `applyPolledNotebookEdits()` was not called after the visible-cell update cycle.
- [Staled metadata text that causes wrong remote change detection](https://github.com/allen-li1231/zeppelin-vscode/commit/48063e6c1171b52e37ab699401c392e9ea25dae6).
- [Staled remote paragraph that executes outdated code](https://github.com/allen-li1231/zeppelin-vscode/commit/4cca6ec79367e00ebb2cd3a197a628b5c65e236c).

### Enhancement
- [Diff view for sync conflicts upgraded from plain text diff to notebook-level cell diff](https://github.com/allen-li1231/zeppelin-vscode/commit/90e0b61296af162193374d907d5efb544c0312d7), showing both cell text and execution outputs side-by-side using an in-memory `FileSystemProvider` (`zeppelin-diff` scheme).
- [Centralize cell.metadata.status setting and periodically flush polled notebook edits to keep local metadata updated](https://github.com/allen-li1231/zeppelin-vscode/commit/f34988b2a5bd7a805a1e0824518cab550db3e6f7).



## [0.2.24] - 2026-06-18

### Added
- [Comprehensive test suite for `notebookKernel.ts`](https://github.com/allen-li1231/zeppelin-vscode/commit/a0f743e1f57a178716ceb7fb90cf7a904c5bef5e) (67 tests covering lifecycle, sync, conflict resolution, paragraph CRUD, mutex guards, and more).
- Auto-detect cell language from Magic commands using a cached interpreter map populated on kernel activation ([#39](https://github.com/allen-li1231/zeppelin-vscode/issues/39)).
- Session-expiry handler: prompts re-login or server change when the Zeppelin session expires mid-use.

### Fixed
- [Operator precedence bug in `getNoteInfo` warning message — ternary was swallowed by string concatenation](https://github.com/allen-li1231/zeppelin-vscode/commit/8e8576b06db632cd2b8c7fad5f4b4c44efc9f239).
- [Missing `break` statements in `parseCellOutputsToParagraphResult` switch](https://github.com/allen-li1231/zeppelin-vscode/commit/76b3f620314648d762974ba31848319edf501aa8), causing fall-through to wrong output types.
- [Regex in `notebookSerializer` using `new RegExp` string constructor that silently matched nothing (replaced with regex literal)](https://github.com/allen-li1231/zeppelin-vscode/commit/d1ff6e668eedb39bd36e65ec4b175b1748269d6c).
- [Race conditions in notebook kernel: metadata updates applied instantly after `doUpdateVisibleCells`](https://github.com/allen-li1231/zeppelin-vscode/commit/e1da17d7371fca7a4072bfcf8d905a90971bdcdb); cell status bar triggered immediately on network errors.
- [Incorrect interpreter ID format in cell status detection](https://github.com/allen-li1231/zeppelin-vscode/commit/0ebed4ae2773bee72018c59da3f506eb64e2651c).

### Enhancement
- [Refactor multi-level logging, configurable in settings and instead of printing to console, outputs are now in VSCode output channel](https://github.com/allen-li1231/zeppelin-vscode/commit/a0f743e1f57a178716ceb7fb90cf7a904c5bef5e).
- [`updateMutex` and `editMutex` made private; developer now use `isEditLocked()` / `isUpdateLocked()` accessor methods](https://github.com/allen-li1231/zeppelin-vscode/commit/76471af69fcf77b137e0fbc807636d1d45480fbe).


## [0.2.25] - 2026-06-22

### Fixed
- Missing await on runParagraph calls causing no output on remote connections (all concurrency modes).
- Missing execution.start() in the sync execution path.