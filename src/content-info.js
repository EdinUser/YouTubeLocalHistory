(function() {
    'use strict';

    function createContentInfoHelpers(dependencies) {
        const log = dependencies.log;
        const storage = dependencies.storage;

        function showExtensionInfo() {
            storage.get(['infoShown']).then(result => {
                if (!result.infoShown) {
                    const topLevelButtons = document.querySelector('#top-level-buttons-computed');
                    if (!topLevelButtons) return;

                    const infoDiv = document.createElement('div');
                    infoDiv.className = 'ytvht-info';

                    const contentDiv = document.createElement('div');
                    contentDiv.className = 'ytvht-info-content';

                    const textDiv = document.createElement('div');
                    textDiv.className = 'ytvht-info-text';

                    const titleDiv = document.createElement('div');
                    titleDiv.className = 'ytvht-info-title';
                    titleDiv.textContent = 'YT re:Watch is active';

                    const descDiv = document.createElement('div');
                    descDiv.className = 'ytvht-info-description';
                    descDiv.innerHTML = 'Your watch progress is being saved locally. Click the extension icon <span class="ytvht-info-highlight">Open</span> to continue watching or open your local feed.';

                    const closeButton = document.createElement('button');
                    closeButton.className = 'ytvht-close';
                    closeButton.textContent = 'x';

                    textDiv.appendChild(titleDiv);
                    textDiv.appendChild(descDiv);
                    contentDiv.appendChild(textDiv);
                    contentDiv.appendChild(closeButton);
                    infoDiv.appendChild(contentDiv);

                    closeButton.addEventListener('click', () => {
                        infoDiv.style.display = 'none';
                        storage.set({ infoShown: true });
                    });

                    const container = topLevelButtons.closest('#actions');
                    if (container) {
                        container.style.position = 'relative';
                        container.appendChild(infoDiv);
                    } else {
                        topLevelButtons.parentElement.style.position = 'relative';
                        topLevelButtons.parentElement.appendChild(infoDiv);
                    }

                    log('Info div added to page');
                }
            }).catch(error => {
                log('Error checking infoShown status:', error);
            });
        }

        return {
            showExtensionInfo
        };
    }

    window.YTVHTContentInfo = {
        create: createContentInfoHelpers
    };
})();
