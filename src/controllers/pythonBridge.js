// controllers/pythonBridge.js
// Helper to POST an SDP offer to the Python media service and return the SDP answer

import fetch from 'node-fetch';  // npm install node-fetch@2

/**
 * Send an SDP offer + media parameters to Python service
 * @param {{ type: string, sdp: string, width: number, height: number, frame_rate: number }} payload
 * @returns {Promise<{ type: string, sdp: string }>}
 */
export async function fetchPythonAnswer(payload) {
    const response = await fetch('http://127.0.0.1:8081/offer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Python media service error: ${response.status} ${errorText}`);
    }

    const answer = await response.json();
    return answer;
}

/**
 * Fetch the true ball position from Python media service
 * @returns {Promise<{x: number, y: number}>}
 */
export async function fetchTruePosition() {
    const res = await fetch('http://127.0.0.1:8081/position');
    if (!res.ok) throw new Error(`Failed to fetch position: ${res.statusText}`);
    return res.json();
}
