const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

/** Run a snippet in the page. `userGesture` lets it open file pickers. */
function runInPage(code, userGesture = false) {
    if (!mainWindow) return;
    mainWindow.webContents.executeJavaScript(code, userGesture).catch(err => console.error(err));
}

function createWindow() {
    const iconPath = path.join(__dirname, 'icon.png');
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 880,
        minWidth: 820,
        minHeight: 600,
        title: 'Chess Opening Repertoire Trainer',
        backgroundColor: '#0f1923', // no white flash before the page paints
        show: false,
        ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
        }
    });

    mainWindow.once('ready-to-show', () => mainWindow.show());
    mainWindow.loadFile('index.html');

    // The app is a single page: open external links in the browser and
    // never navigate the window away from it.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:/.test(url)) shell.openExternal(url);
        return { action: 'deny' };
    });
    mainWindow.webContents.on('will-navigate', (event, url) => {
        if (url !== mainWindow.webContents.getURL()) event.preventDefault();
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function buildMenu() {
    const template = [
        {
            label: 'File',
            submenu: [
                {
                    label: 'Import PGN...',
                    accelerator: 'CmdOrCtrl+I',
                    click: () => runInPage("document.getElementById('btn-import').click();")
                },
                {
                    label: 'New Repertoire...',
                    accelerator: 'CmdOrCtrl+N',
                    click: () => runInPage("document.getElementById('btn-new-repertoire').click();")
                },
                { type: 'separator' },
                {
                    label: 'Backup All Data...',
                    accelerator: 'CmdOrCtrl+B',
                    click: () => runInPage("document.getElementById('btn-backup').click();")
                },
                {
                    label: 'Restore from Backup...',
                    accelerator: 'CmdOrCtrl+Shift+B',
                    // Opens the app's own file picker (needs a user gesture).
                    click: () => runInPage("document.getElementById('restore-file').click();", true)
                },
                { type: 'separator' },
                {
                    label: 'Quit',
                    accelerator: 'CmdOrCtrl+Q',
                    click: () => app.quit()
                }
            ]
        },
        {
            label: 'View',
            submenu: [
                {
                    label: 'Home',
                    accelerator: 'CmdOrCtrl+H',
                    click: () => runInPage("document.getElementById('btn-home').click();")
                },
                {
                    label: 'Sandbox Board',
                    accelerator: 'CmdOrCtrl+Shift+S',
                    click: () => runInPage("document.getElementById('btn-sandbox').click();")
                },
                { type: 'separator' },
                {
                    label: 'Toggle Full Screen',
                    accelerator: 'F11',
                    click: () => mainWindow && mainWindow.setFullScreen(!mainWindow.isFullScreen())
                },
                {
                    label: 'Toggle Developer Tools',
                    accelerator: 'F12',
                    click: () => mainWindow && mainWindow.webContents.toggleDevTools()
                },
                { type: 'separator' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { role: 'resetZoom' }
            ]
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'Keyboard Shortcuts',
                    accelerator: 'F1',
                    click: () => runInPage('window.app && window.app._showShortcuts();')
                }
            ]
        }
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
    createWindow();
    buildMenu();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
