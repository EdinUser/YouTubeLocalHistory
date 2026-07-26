(function() {
    'use strict';

    function createContentImportHelpers(dependencies) {
        const log = dependencies.log;
        const getStorage = dependencies.getStorage;

        async function runImport(records, playlists, mergeMode) {
            return getStorage().importRecords(records || [], playlists || [], !!mergeMode);
        }

        function maybeShowImportOverlayFromHash() {
            if (window.location.hash === '#ytlh_import') {
                showImportOverlay();
            }
        }

        function showImportOverlay() {
            if (document.getElementById('ytvhtImportOverlay')) {
                return;
            }
            if (!document.body) {
                return;
            }

            const overlay = document.createElement('div');
            overlay.id = 'ytvhtImportOverlay';
            overlay.style.position = 'fixed';
            overlay.style.inset = '0';
            overlay.style.background = 'rgba(0,0,0,0.4)';
            overlay.style.zIndex = '999999';
            overlay.style.display = 'flex';
            overlay.style.alignItems = 'center';
            overlay.style.justifyContent = 'center';

            const modal = document.createElement('div');
            modal.style.background = '#222';
            modal.style.color = '#fff';
            modal.style.padding = '20px';
            modal.style.borderRadius = '8px';
            modal.style.minWidth = '360px';
            modal.style.maxWidth = '480px';
            modal.style.boxShadow = '0 4px 16px rgba(0,0,0,0.5)';

            modal.innerHTML = `
                <h3 style="margin-top:0;margin-bottom:12px;">Choose a file to import:</h3>
                <input id="ytvhtImportFile" type="file" accept=".json" style="margin: 10px 0; width: 100%;">
                <div style="margin: 10px 0; font-size: 13px;">
                    <label style="margin-right:12px;">
                        <input id="ytvhtImportMerge" type="radio" name="ytvhtImportMode" checked>
                        Merge with existing data
                    </label>
                    <label>
                        <input id="ytvhtImportReplace" type="radio" name="ytvhtImportMode">
                        Replace existing data
                    </label>
                </div>
                <div style="margin-top: 12px; text-align: right;">
                    <button id="ytvhtImportCancel" style="margin-right:8px;">Cancel</button>
                    <button id="ytvhtImportStart">Import</button>
                </div>
                <div id="ytvhtImportStatus" style="margin-top: 10px; font-size: 12px;"></div>
            `;

            overlay.appendChild(modal);
            document.body.appendChild(overlay);

            const fileInput = modal.querySelector('#ytvhtImportFile');
            const mergeRadio = modal.querySelector('#ytvhtImportMerge');
            const statusEl = modal.querySelector('#ytvhtImportStatus');

            modal.querySelector('#ytvhtImportCancel').onclick = () => {
                overlay.remove();
                if (window.location.hash === '#ytlh_import') {
                    try {
                        history.replaceState(null, '', window.location.pathname + window.location.search);
                    } catch (e) {
                        log('Error clearing import hash:', e);
                    }
                }
            };

            modal.querySelector('#ytvhtImportStart').onclick = async () => {
                const file = fileInput.files && fileInput.files[0];
                if (!file) {
                    statusEl.textContent = 'Please choose a JSON file.';
                    return;
                }

                try {
                    statusEl.textContent = 'Reading file...';
                    const text = await file.text();
                    const data = JSON.parse(text);

                    let records = [];
                    let playlists = [];
                    let mergeMode = !!mergeRadio.checked;

                    if (data && typeof data === 'object' && data.history) {
                        if (Array.isArray(data.history)) {
                            records = data.history;
                        } else if (typeof data.history === 'object') {
                            records = Object.values(data.history);
                        } else {
                            throw new Error('Invalid file format: unexpected history structure');
                        }

                        if (Array.isArray(data.playlists)) {
                            playlists = data.playlists;
                        } else if (data.playlists && typeof data.playlists === 'object') {
                            playlists = Object.values(data.playlists);
                        }
                    } else if (Array.isArray(data)) {
                        records = data;
                        mergeMode = false;
                    } else {
                        throw new Error('Invalid file format: expected an array of videos or an object with history/playlists');
                    }

                    if (!records.length && !playlists.length) {
                        statusEl.textContent = 'No videos or playlists found in file.';
                        return;
                    }

                    statusEl.textContent = 'Importing...';

                    try {
                        const response = await runImport(records, playlists, mergeMode);

                        if (response && response.status === 'success') {
                            statusEl.textContent =
                                `Import complete: ${response.importedVideos} videos, ` +
                                `${response.importedPlaylists} playlists.`;
                        } else {
                            const errorMsg = response && response.error ? response.error : 'Unknown error';
                            statusEl.textContent = `Import failed: ${errorMsg}`;
                            console.error('Import failed:', errorMsg);
                        }
                    } catch (importError) {
                        console.error('Import overlay error:', importError);
                        let errorMsg = importError.message || 'Unknown error';

                        if (errorMsg.includes('Extension context invalidated') || errorMsg.includes('Background script')) {
                            errorMsg = 'Extension context lost. Please reload the extension and try again.';
                        } else if (errorMsg.includes('IndexedDB')) {
                            errorMsg = 'IndexedDB not available. Please reload the extension.';
                        }

                        statusEl.textContent = `Error: ${errorMsg}`;
                    }
                } catch (err) {
                    console.error('Import overlay error:', err);
                    statusEl.textContent = `Error: ${err.message || 'Unknown error'}`;
                }
            };
        }

        return {
            runImport,
            maybeShowImportOverlayFromHash,
            showImportOverlay
        };
    }

    window.YTVHTContentImport = {
        create: createContentImportHelpers
    };
})();
