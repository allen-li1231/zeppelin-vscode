# Zeppelin Extension for Visual Studio Code

A [Visual Studio Code](https://code.visualstudio.com/) extension that provides basic notebook support for language kernels in [Zeppelin Notebooks](https://zeppelin.apache.org/). This is _**NOT a Zeppelin Server or language kernel**_--you must have a Zeppelin Server 0.8.0 or afterwards for notebooks to run properly in VS Code.
Currently the extension development does not consider notebook permission, version control and cron job. If you believe these are important, please fire an issue.

## Features
* Zeppelin notebook file rendered in VS Code, just like Juypter Notebook does.
* Paragraph runnable (either in sequence or in parallel) in notebook, by communicating with Zeppelin server.
* Local changes automatically synced with server, vice versa.
* **Sync conflict resolution**: When a cell differs from the server, you can view a side-by-side diff and choose to accept the remote version or keep your local changes.
* **Rich output rendering**: tabular results (`%table` output, Spark/PySpark DataFrames, `Row` collections, and `DataFrame[...]` schemas) render as interactive HTML tables/cards with per-cell copy and CSV export; long or multi-line text output uses an enhanced text view.
* **Manual recovery**: refresh a notebook from the server and restart interpreters on demand, for when a connection hiccups or an interpreter gets stuck.
* Connection via **HTTP(S)** with optional proxy, custom CA / client certificates, and credentials stored in VS Code secret storage.

## Get Started
* Install Zeppelin VS Code Extension.
* Download Zeppelin notebook file (either .json or .zpln) from Zeppelin web server.
* Rename file suffix into ".zpln" if it is ".json".
* Open it using VS Code, during first cell run you will be prompted to provide server url and credential.
* This extension works seamlessly with Remote SSH and git.

## Commands
Open the Command Palette (`Ctrl/Cmd+Shift+P`) and search for `Zeppelin`. Commands marked *(notebook)* are only available while a `.zpln` (or `.ipynb`) file is the active editor.

| Command | What it does |
| --- | --- |
| **Zeppelin: Set Zeppelin Server URL** | Choose or enter the Zeppelin server to connect to. |
| **Zeppelin: Set Zeppelin Credential** | Store your username/password (kept in VS Code secret storage). |
| **Zeppelin: Import Current Notebook to Zeppelin Server** *(notebook)* | Create the current `.zpln`/`.ipynb` on the server and start syncing it. |
| **Zeppelin: Refresh Notebook from Server** *(notebook)* | Re-sync the active notebook from the server on demand (also on the notebook toolbar). |
| **Zeppelin: restart a interpreter** *(notebook)* | Restart an interpreter used by the notebook (auto-detected — see below). |
| **Zeppelin: Show Cell Diff (Local vs Remote)** *(notebook)* | Open a side-by-side diff for a cell that differs from the server. |
| **Zeppelin: Accept Remote Cell Version** *(notebook)* | Replace the local cell with the server version. |

> Conflict commands (*Show Cell Diff*, *Accept Remote*, *Keep Local*) are usually triggered from the **Remote Changed** buttons in the cell status bar rather than the palette — see [Sync Conflict Resolution](#sync-conflict-resolution).

## How to Use
* Want to create a notebook (.zpln file) that doesn't exist on the server? Just create and open it locally and specify the saving path as prompted.
* Zeppelin credential and network settings can be accessed by searching for 'zeppelin' in setting or command palette.
* In Zeppelin web UI, code languages are determined by magic command, while in VSCode you need to manually select the language mode in the bottom right corner of the cell. If you cannot find the desired language in the list, please search and install the extension that supports as language server from VSCode extension marketplace.

### Notebook Toolbar
The toolbar at the top-right of an open `.zpln` notebook provides on-demand actions:
* **Refresh Notebook** (:arrows_counterclockwise:) — manually re-sync the active notebook from the server, e.g. after a network blip or if you suspect local and server state have drifted. A short cooldown prevents accidental repeated full syncs.

### Cell Status Bar
Each cell shows status indicators at its bottom-right:
* Once an interpreter is typed in the cell (e.g., `%python`), its **status** is shown; click it to restart that interpreter.
* When the server version of a cell differs from yours, a **Remote Changed** indicator with resolution buttons appears — see [Sync Conflict Resolution](#sync-conflict-resolution).

### Restart Interpreter
Besides clicking a cell's interpreter status, run **"Zeppelin: restart a interpreter"** from the command palette. It auto-detects the interpreters used in the current notebook from the cells' magic prefixes (e.g. `%spark`, `%python`): if one is found it is used directly, if several are present you are asked which to restart, and if none are detected you can type one in. Interpreter group names are resolved automatically (e.g. `pyspark` restarts the `spark` group).

### Output Rendering
Common Zeppelin and Spark result shapes are rendered as interactive HTML instead of raw text:
* `%table` results and tab-separated / `df.show()` tables → HTML tables, with buttons to **Copy** a cell value, **Download** the table as CSV, and **Expand** long cells.
* PySpark `Row(...)` and `[Row(...), ...]` collections, and `DataFrame[...]` schemas → rendered as tables / schema cards.
* Long or multi-line plain-text output → an enhanced text view; short text and live progress-bar output stay as plain text.

Rendering is display-only — it never changes the data saved to your notebook file or pushed to the server. Unrecognized output always falls back to plain text.

### Sync Conflict Resolution
When the server version of a cell differs from your local version, a **"Remote Changed"** indicator appears in the cell status bar with two action buttons:
* **Accept Remote** — replaces your local cell with the server version.
* **Keep Local** — pushes your local version to the server, overwriting the remote.

Click the "Remote Changed" button to open a side-by-side diff view. While the diff is detected, the cell is locked: it cannot be executed and local edits won't be pushed to the server until you resolve the conflict by choosing one of the two options.

## Settings
Search `zeppelin` in VS Code Settings to configure the extension. Key options:

| Setting | Default | Description |
| --- | --- | --- |
| `zeppelin.alwaysConnectToTheLastServer` | `Yes` | Whether to auto-connect to the last-used server (`Yes` / `No` / `Never`). |
| `zeppelin.autosave.syncActiveNotebook` | `true` | Sync a notebook with the server when it becomes the active editor. |
| `zeppelin.autosave.throttleTime` | `3` | Delay (seconds) before pushing a paragraph edit, to avoid flooding the server. |
| `zeppelin.autosave.poolingInterval` | `5` | Minimum interval (seconds) between saves to the server. |
| `zeppelin.execution.concurrency` | `by interpreter` | How cells run: `by interpreter`, `parallel`, or `sequential`. |
| `zeppelin.execution.trackInterval` | `1` | Interval (seconds) for polling running-cell status. |
| `zeppelin.interpreter.trackInterval` | `5` | Interval (seconds) for polling interpreter status. |
| `zeppelin.logLevel` | `info` | Log verbosity in the Output panel (`debug`/`info`/`warn`/`error`/`off`). |
| `zeppelin.https.timeout` | `10` | Global HTTP request timeout (seconds). |
| `zeppelin.https.rejectUnauthorized` | `true` | Verify the server TLS certificate. Disable only for trusted private endpoints. |

Additional **proxy** (`zeppelin.proxy.*`) and **TLS** (`zeppelin.https.CA-Certification`, `zeppelin.https.KeyPath`, `zeppelin.https.passphase`) options are available for custom network setups — search `zeppelin.proxy` / `zeppelin.https` in Settings.

### :bell:Tips
* Internally local changes to the notebook are updated to the Zeppelin server in every 3 seconds (by default),
  and local notebook file will be completely replaced by the server version __every time it is opened or activated__. You may disable this in settings.
* If you cannot see the progress bar, it is in the text output, you can toggle output type by clicking "..." button at the left side of the cell output.
* Please avoid modifying a running cell (i.e., editing, moving cell, cut/copy and paste cell. Deleting is allowed) as Zeppelin doesn't support this while VSCode does. If you accidentally did this, close and reopen the notebook to ensure the notebook is synced.

## Feedback
__Desperately needed! Please do report bugs or advise any improvements.__
__I realize many people use this extension for a better code completion and highlight, if you cannot find a language in the list of cell language model that is supported in Zeppelin, please do let me know by firing an issue.__
