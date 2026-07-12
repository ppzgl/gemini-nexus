(function () {
    function cropImage(base64, area) {
        return new Promise((resolve, reject) => {
            const imageElement = new Image();
            imageElement.onload = () => {
                const canvas = document.createElement('canvas');
                const canvasContext = canvas.getContext('2d');
                if (!canvasContext) {
                    reject(new Error('Canvas 2D context is unavailable.'));
                    return;
                }

                const scale = area.pixelRatio || 1;
                canvas.width = area.width * scale;
                canvas.height = area.height * scale;

                canvasContext.drawImage(
                    imageElement,
                    area.x * scale,
                    area.y * scale,
                    area.width * scale,
                    area.height * scale,
                    0,
                    0,
                    canvas.width,
                    canvas.height
                );

                // A cross-origin image (no CORS) taints the canvas, so
                // toDataURL() throws a SecurityError. Previously this threw
                // out of the onload handler as an uncaught rejection with no
                // user feedback. Catch it here and surface a clear error so
                // the caller can show the user that this image can't be cropped
                // instead of failing silently.
                try {
                    resolve(canvas.toDataURL('image/png'));
                } catch (error) {
                    const reason =
                        error?.name === 'SecurityError' ||
                        /taint|security/i.test(error?.message || '')
                            ? 'This cross-origin image cannot be cropped due to browser security (canvas taint).'
                            : error?.message || 'Failed to read cropped image from canvas.';
                    reject(new Error(reason));
                }
            };
            imageElement.onerror = () => reject(new Error('Failed to load image for cropping.'));
            imageElement.src = base64;
        });
    }

    globalThis.GeminiNexusCrop = {
        ...(globalThis.GeminiNexusCrop || {}),
        cropImage,
    };
})();
