# Zeppelin Extension for Visual Studio Code

A [Visual Studio Code](https://code.visualstudio.com/) extension that provides basic notebook support for language kernels in [Zeppelin Notebooks](https://zeppelin.apache.org/). This is _**NOT a Zeppelin Server or language kernel**_--you must have a Zeppelin Server 0.8.0 or afterwards for notebooks to run properly in VS Code.
Currently the extension development does not consider notebook permission, version control and cron job. If you believe these are important, please fire an issue.

## Features
* Zeppelin notebook file rendered in VS Code, just like Juypter Notebook does.
* Paragraph runnable (either in sequence or in parallel) in notebook, by communicating with Zeppelin server.
* Local changes automatically synced with server, vice versa.

## How to Use
* Install Zeppelin VS Code Extension.
* Download Zeppelin notebook file (either .json or .zpln) from Zeppelin web server.
* Rename file suffix into ".zpln" if it is ".json".
* Open it using VS Code, during first cell run you will be prompted to provide server url and credential.

More configurations can be accessed by searching for 'zeppelin' in setting or command palette.

### :bell:Tips
* Internally local changes to the notebook are updated to the Zeppelin server in every 3 seconds (by default),
  and local notebook file will be completely replaced by the server version the moment it is opened or activated. You may disable this in settings.
* If you cannot see the progress bar, it is in the text output, you can toggle output type by clicking "..." button at the left side of the cell output.
* In Zeppelin web UI, code languages are determined by magic command, while in VSCode you need to manually select the language in the bottom right corner of the cell. If you cannot find the desired language in the list, please search and install the extension that supports as language server from extension marketplace.

## Feedback
__Desperately needed! Please do report bugs or advise any improvements.__
__I realize many people use this extension for a better code completion and highlight, if you cannot find a language in the list of cell language model that is supported in Zeppelin, please do let me know by firing an issue.__