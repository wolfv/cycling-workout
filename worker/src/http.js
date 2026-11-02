// Small HTTP helpers shared by all API modules: uniform JSON errors and bounded body reading.

export const ERROR_BY_STATUS = {
    400: 'invalid_request',
    401: 'unauthenticated',
    403: 'forbidden',
    404: 'not_found',
    405: 'method_not_allowed',
    409: 'conflict',
    413: 'payload_too_large',
    422: 'invalid_request',
    428: 'precondition_required',
    429: 'rate_limited'
};

export function errorCodeForStatus(status) {
    return ERROR_BY_STATUS[status] || (status >= 500 ? 'internal' : 'invalid_request');
}

export function json(data, status = 200, headers = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers }
    });
}

export function errorResponse(status, code, message, headers = {}) {
    return json({ error: code || errorCodeForStatus(status), message }, status, headers);
}

export class HttpError extends Error {
    constructor(status, code, message, headers) {
        super(message);
        this.status = status;
        this.code = code;
        this.headers = headers;
    }
}

export function badRequest(message) {
    return new HttpError(400, 'invalid_request', message);
}

/**
 * Reads a request body as text and refuses anything larger than `maxBytes` (413),
 * without buffering more than maxBytes + one chunk.
 */
export async function readBodyText(request, maxBytes) {
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
        throw new HttpError(413, 'payload_too_large', `Request body is larger than ${maxBytes} bytes.`);
    }
    if (!request.body) return '';
    const reader = request.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel();
            throw new HttpError(413, 'payload_too_large', `Request body is larger than ${maxBytes} bytes.`);
        }
        chunks.push(value);
    }
    const all = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        all.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new TextDecoder().decode(all);
}

export async function readJsonBody(request, maxBytes) {
    const text = await readBodyText(request, maxBytes);
    try {
        return JSON.parse(text);
    } catch {
        throw badRequest('Request body must be valid JSON.');
    }
}

export function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
