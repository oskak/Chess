const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 850,
        minWidth: 800,
        minHeight: 600,
        title: 'Chess Opening Repertoire Trainer',
        icon: path.join(__dirname, 'icon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    mainWindow.loadFile('index.html');

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
                    click: () => {
                        mainWindow.webContents.executeJavaScript(
                            "document.getElementById('btn-import').click();"
                        );
                    }
                },
                {
                    label: 'Backup All Data...',
                    accelerator: 'CmdOrCtrl+B',
                    click: () => {
                        mainWindow.webContents.executeJavaScript(
                            "document.getElementById('btn-backup').click();"
                        );
                    }
                },
                {
                    label: 'Restore from Backup...',
                    accelerator: 'CmdOrCtrl+Shift+B',
                    click: async () => {
                        const result = await dialog.showOpenDialog(mainWindow, {
                            title: 'Restore from Backup',
                            filters: [{ name: 'JSON Backup', extensions: ['json'] }],
                            properties: ['openFile']
                        });
                        if (!result.canceled && result.filePaths.length > 0) {
                            const filePath = result.filePaths[0];
                            mainWindow.webContents.executeJavaScript(`
                                (async () => {
                                    const resp = await fetch('file://${filePath.replace(/\\/g, '/')}');
                                    const text = await resp.text();
                                    const blob = new Blob([text], {type: 'application/json'});
                                    const file = new File([blob], '${path.basename(filePath)}', {type: 'application/json'});
                                    window.app._restoreFromFile(file);
                                })();
                            `);
                        }
                    }
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
                    click: () => {
                        mainWindow.webContents.executeJavaScript(
                            "document.getElementById('btn-home').click();"
                        );
                    }
                },
                { type: 'separator' },
                {
                    label: 'Toggle Full Screen',
                    accelerator: 'F11',
                    click: () => {
                        mainWindow.setFullScreen(!mainWindow.isFullScreen());
                    }
                },
                {
                    label: 'Toggle Developer Tools',
                    accelerator: 'F12',
                    click: () => {
                        mainWindow.webContents.toggleDevTools();
                    }
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
                    click: () => {
                        dialog.showMessageBox(mainWindow, {
                            type: 'info',
                            title: 'Keyboard Shortcuts',
                            message: 'Keyboard Shortcuts',
                            detail: [
                                'F - Flip board',
                                'H - Toggle hints (training)',
                                'M - Toggle sounds',
                                'Left Arrow - Undo move (explorer)',
                                'Ctrl+I - Import PGN',
                                'Ctrl+B - Backup data',
                                'Ctrl+Shift+B - Restore backup',
                                'F11 - Full screen'
                            ].join('\n')
                        });
                    }
                }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
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
