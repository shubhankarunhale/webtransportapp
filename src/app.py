import asyncio
import numpy as np
import av
from aiohttp import web
from aiortc import RTCPeerConnection, RTCSessionDescription, VideoStreamTrack, RTCRtpSender

# Global true ball position 
last_x = None
last_y = None

class BouncingBallTrack(VideoStreamTrack):
    """
    A VideoStreamTrack that generates a bouncing ball animation.
    """
    def __init__(self, width=640, height=480, frame_rate=60):
        super().__init__()
        self.width = width
        self.height = height
        self.frame_rate = frame_rate
        self.ball_radius = min(width, height) // 10
        self.speed = 200 
        self.x = self.ball_radius
        self.y = self.ball_radius
        self.dx = self.speed
        self.dy = self.speed
        self.interval = 1 / frame_rate

    async def recv(self):
        pts, time_base = await self.next_timestamp()
        # update bounce physics
        dt = self.interval
        self.x += self.dx * dt
        self.y += self.dy * dt
        if self.x <= self.ball_radius or self.x >= self.width - self.ball_radius:
            self.dx *= -1
        if self.y <= self.ball_radius or self.y >= self.height - self.ball_radius:
            self.dy *= -1
        # draw frame
        img = np.zeros((self.height, self.width, 3), dtype=np.uint8)
        yy, xx = np.ogrid[:self.height, :self.width]
        mask = (xx - int(self.x))**2 + (yy - int(self.y))**2 <= self.ball_radius**2
        img[mask] = (255, 255, 255)
        frame = av.VideoFrame.from_ndarray(img, format="bgr24")
        frame.pts = pts
        frame.time_base = time_base
        # Update global true position
        global last_x, last_y
        last_x = self.x
        last_y = self.y
        await asyncio.sleep(self.interval)
        return frame

async def offer_handler(request):
    params = await request.json()
    offer = RTCSessionDescription(sdp=params["sdp"], type=params["type"])
    width = params.get("width", 640)
    height = params.get("height", 480)
    frame_rate = params.get("frame_rate", 30)

    pc = RTCPeerConnection()
    pc.addTrack(BouncingBallTrack(width, height, frame_rate))

    # configure H264 preference
    h264_codecs = [c for c in RTCRtpSender.getCapabilities("video").codecs if c.mimeType == "video/H264"]
    for transceiver in pc.getTransceivers():
        if transceiver.kind == "video":
            transceiver.setCodecPreferences(h264_codecs)

    await pc.setRemoteDescription(offer)
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    # wait for ICE gathering to complete
    while pc.iceGatheringState != 'complete':
        await asyncio.sleep(0.1)

    return web.json_response({
        "type": pc.localDescription.type,
        "sdp": pc.localDescription.sdp
    })

app = web.Application()
app.router.add_post('/offer', offer_handler)
app.router.add_get('/', lambda req: web.Response(text='Python media service (H264) running'))
# Endpoint to fetch the true ball position for error calculation
app.router.add_get('/position', lambda req: web.json_response({'x': last_x, 'y': last_y}))

if __name__ == '__main__':
    web.run_app(app, port=8081)
