// Client-side image compression shared by every photo uploader. Downscales
// anything over 1MB to a max 1920px edge and re-encodes as JPEG at 0.85
// quality, which is what keeps large phone-camera photos under the ~4.5MB
// body limit Vercel's serverless functions enforce on every upload route.
export const compressImage = (file) =>
  new Promise((resolve) => {
    // Skip files already under 1 MB
    if (file.size < 1 * 1024 * 1024) {
      resolve(file);
      return;
    }
    // window.Image, not the next/image import some callers shadow the global with.
    const img = new window.Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 1920;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        const ratio = Math.min(MAX / width, MAX / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (!blob || blob.size >= file.size) {
            resolve(file);
            return;
          }
          resolve(
            new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), {
              type: "image/jpeg",
            })
          );
        },
        "image/jpeg",
        0.85
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
