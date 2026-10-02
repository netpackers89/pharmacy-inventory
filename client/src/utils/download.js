/**
 * download.js — trigger a browser download for a Blob returned by the API.
 *
 * The API is JWT-protected and the token lives in localStorage (attached by the
 * axios interceptor), so a plain <a href> would not be authenticated. These
 * helpers let the caller fetch the file as a Blob first, then save it locally.
 */

/** Read the server-provided filename from a Content-Disposition header. */
export const filenameFromDisposition = (headers, fallback = 'report.xlsx') => {
  const raw = headers?.['content-disposition'] || headers?.['Content-Disposition'] || '';
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(raw);
  if (!match) return fallback;
  try {
    return decodeURIComponent(match[1].trim()) || fallback;
  } catch (_) {
    return match[1].trim() || fallback;
  }
};

/** Save a Blob to the user's Downloads folder. */
export const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
};

/**
 * Persist an axios response as a file download.
 * Handles the blob body plus the server's filename, and surfaces a JSON error
 * body (returned as a Blob by axios even on failure) as a readable message.
 */
export const saveAxiosFile = async (response, fallbackName = 'report.xlsx') => {
  const data = response?.data;
  if (!(data instanceof Blob)) {
    downloadBlob(new Blob([data]), fallbackName);
    return;
  }
  // A JSON error body arrives as a Blob with a JSON mime type.
  if (data.type && data.type.includes('application/json')) {
    const text = await data.text();
    let message = 'The server could not generate this file.';
    try { message = JSON.parse(text).error || message; } catch (_) { /* keep default */ }
    throw new Error(message);
  }
  downloadBlob(data, filenameFromDisposition(response.headers, fallbackName));
};