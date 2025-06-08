import { parentPort, workerData } from 'worker_threads';
import { createCanvas } from 'canvas';

// Extract worker config
const { width, height, frameRate } = workerData;

// Canvas setup
const canvas = createCanvas(width, height);
const ctx = canvas.getContext('2d');

// Ball parameters
const ballSpeed = 250;
const initialAngle = Math.random() * 2 * Math.PI;
const ball = {
    x: width / 2,
    y: height / 2,
    vx: Math.cos(initialAngle) * ballSpeed,
    vy: Math.sin(initialAngle) * ballSpeed,
    radius: 20
};

// Utility: update ball position
function updateBall(deltaSeconds) {
    ball.x += ball.vx * deltaSeconds;
    ball.y += ball.vy * deltaSeconds;

    if (ball.x - ball.radius < 0 || ball.x + ball.radius > width) {
        ball.vx = -ball.vx;
        ball.x = Math.max(ball.radius, Math.min(width - ball.radius, ball.x));
    }
    if (ball.y - ball.radius < 0 || ball.y + ball.radius > height) {
        ball.vy = -ball.vy;
        ball.y = Math.max(ball.radius, Math.min(height - ball.radius, ball.y));
    }
}

// Prepare I420 buffer
const ySize = width * height;
const uvSize = (width >> 1) * (height >> 1);
const i420Array = new Uint8Array(ySize + uvSize * 2);

// Frame interval
const intervalMs = 1000 / Math.max(1, Math.min(60, frameRate));
const deltaSec = intervalMs / 1000;

// Frame generation loop
setInterval(() => {
    // 1) Update ball and draw
    updateBall(deltaSec);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
    ctx.fill();

    // 2) Convert to I420
    const imageData = ctx.getImageData(0, 0, width, height).data;
    let yp = 0;
    for (let j = 0; j < height; j++) {
        for (let i = 0; i < width; i++, yp++) {
            const idx = (j * width + i) * 4;
            const r = imageData[idx], g = imageData[idx + 1], b = imageData[idx + 2];
            i420Array[yp] = ((0.299 * r + 0.587 * g + 0.114 * b)) | 0;
        }
    }
    let up = ySize;
    let vp = ySize + uvSize;
    for (let j = 0; j < height; j += 2) {
        for (let i = 0; i < width; i += 2) {
            const base = (j * width + i) * 4;
            const r = (imageData[base] + imageData[base + 4] + imageData[base + width * 4] + imageData[base + width * 4 + 4]) / 4;
            const g = (imageData[base + 1] + imageData[base + 5] + imageData[base + width * 4 + 1] + imageData[base + width * 4 + 5]) / 4;
            const b = (imageData[base + 2] + imageData[base + 6] + imageData[base + width * 4 + 2] + imageData[base + width * 4 + 6]) / 4;
            i420Array[up++] = ((-0.168736 * r - 0.331264 * g + 0.5 * b) + 128) | 0;
            i420Array[vp++] = ((0.5 * r - 0.418688 * g - 0.081312 * b) + 128) | 0;
        }
    }

    // Include true ball position in the message
    const bufferCopy = i420Array.slice().buffer;
    parentPort.postMessage({
        i420Buffer: bufferCopy,
        timestamp: Date.now() * 1000,
        ballX: ball.x,
        ballY: ball.y
    });

}, intervalMs);
