// Slide Navigation
const navBtns = document.querySelectorAll(".nav-btn");
const slides = document.querySelectorAll(".slide");

function showSlide(slideName) {
    slides.forEach(slide => slide.classList.remove("active"));
    navBtns.forEach(btn => btn.classList.remove("active"));
    
    document.getElementById(`${slideName}-slide`).classList.add("active");
    document.querySelector(`[data-slide="${slideName}"]`).classList.add("active");
}

navBtns.forEach(btn => {
    btn.addEventListener("click", () => {
        showSlide(btn.getAttribute("data-slide"));
    });
});

// Drawing Canvas Setup
const canvas = document.getElementById("drawingCanvas");
const ctx = canvas.getContext("2d");

let drawing = false;

// Drawing settings
ctx.lineWidth = 5;
ctx.lineCap = "round";
ctx.strokeStyle = "#5A4A42";

// Start drawing
canvas.addEventListener("mousedown", (event) => {
    drawing = true;
    ctx.beginPath();
    ctx.moveTo(event.offsetX, event.offsetY);
});

// Draw
canvas.addEventListener("mousemove", (event) => {
    if (!drawing) return;
    ctx.lineTo(event.offsetX, event.offsetY);
    ctx.stroke();
});

// Stop drawing
canvas.addEventListener("mouseup", () => {
    drawing = false;
});

canvas.addEventListener("mouseleave", () => {
    drawing = false;
});

// Clear canvas
document.getElementById("clearBtn").addEventListener("click", () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    gestureCtx.clearRect(0, 0, gestureCanvas.width, gestureCanvas.height);
    drawingHistory = []; // Clear drawing history
    undoBtn.style.display = "none"; // Hide undo button
    document.getElementById("prediction").textContent = "---";
    document.getElementById("confidence").style.width = "0%";
    document.getElementById("confidenceText").textContent = "0%";
});

// ============= UNDO FUNCTIONALITY =============
let drawingHistory = [];
const undoBtn = document.getElementById("undoBtn");
const MAX_HISTORY = 20; // Maximum undo steps

// Save canvas state to history
function saveDrawingState() {
    // Save gesture canvas state
    const imageData = gestureCtx.getImageData(0, 0, gestureCanvas.width, gestureCanvas.height);
    drawingHistory.push(imageData);
    
    // Limit history size
    if (drawingHistory.length > MAX_HISTORY) {
        drawingHistory.shift();
    }
    
    // Show undo button if in gesture mode and history exists
    if (gestureMode && drawingHistory.length > 0) {
        undoBtn.style.display = "inline-block";
    }
}

// Undo last drawing action
function undoDrawing() {
    if (drawingHistory.length > 0) {
        drawingHistory.pop(); // Remove last state
        
        if (drawingHistory.length > 0) {
            // Restore previous state
            const previousState = drawingHistory[drawingHistory.length - 1];
            gestureCtx.putImageData(previousState, 0, 0);
        } else {
            // Clear canvas if no history left
            gestureCtx.clearRect(0, 0, gestureCanvas.width, gestureCanvas.height);
            undoBtn.style.display = "none";
        }
    }
}

// Undo button event listener
undoBtn.addEventListener("click", undoDrawing);

// Webcam Setup
let stream = null;
const video = document.getElementById("webcamVideo");
const webcamToggleBtn = document.getElementById("webcamToggleBtn");
let handsWebcam = null;
let cameraWebcam = null;
const modeButtons = document.querySelectorAll(".mode-btn");
const inputSections = document.querySelectorAll(".input-section");

// Input mode switching
modeButtons.forEach(btn => {
    btn.addEventListener("click", () => {
        const mode = btn.getAttribute("data-mode");
        
        // Update active buttons
        modeButtons.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        
        // Update input sections
        inputSections.forEach(section => section.classList.remove("active"));
        document.getElementById(`${mode}-mode`).classList.add("active");
        
        // Handle mode switching
        if (mode === "webcam") {
            undoBtn.style.display = "none";
            startWebcam();
        } else if (mode === "gesture") {
            undoBtn.style.display = "none"; // Initially hidden, shows when drawing
            startGesture();
        } else {
            undoBtn.style.display = "none";
            stopWebcam();
            stopGesture();
        }
    });
});

// Start webcam
async function startWebcam() {
    try {
        // Prefer MediaPipe Camera + Hands for webcam mode if available
        const HandsClass = window.Hands;
        const CameraClass = window.Camera;
        const webcamResult = document.getElementById('webcamResult');

        if (HandsClass && CameraClass) {
            if (!handsWebcam) {
                handsWebcam = new HandsClass({
                    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
                });
                handsWebcam.setOptions({
                    maxNumHands: 1,
                    modelComplexity: 1,
                    minDetectionConfidence: 0.6,
                    minTrackingConfidence: 0.6
                });

                handsWebcam.onResults((results) => {
                    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
                        webcamResult.textContent = '👋 HAND DETECTED!';
                    } else {
                        webcamResult.textContent = 'Show your hand ✋';
                    }
                });
            }

            // If a previous Camera is running, stop it first
            if (cameraWebcam && cameraWebcam.stop) {
                try { cameraWebcam.stop(); } catch (e) { /* ignore */ }
                cameraWebcam = null;
            }

            cameraWebcam = new CameraClass(video, {
                onFrame: async () => { await handsWebcam.send({ image: video }); },
                width: 640,
                height: 480
            });

            cameraWebcam.start();
            webcamToggleBtn.style.display = "inline-block";
            webcamToggleBtn.textContent = "📷 Stop Webcam";
            return;
        }

        // Fallback: plain getUserMedia
        stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: "user" }
        });
        video.srcObject = stream;
        webcamToggleBtn.style.display = "inline-block";
        webcamToggleBtn.textContent = "📷 Stop Webcam";
    } catch (err) {
        console.error("Error accessing webcam:", err);
        alert("Unable to access webcam. Please check permissions.");
    }
}

// Stop webcam
function stopWebcam() {
    // Stop MediaPipe Camera if used
    if (cameraWebcam && cameraWebcam.stop) {
        try { cameraWebcam.stop(); } catch (e) { /* ignore */ }
        cameraWebcam = null;
    }

    // Stop getUserMedia stream if used
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }

    webcamToggleBtn.style.display = "none";

    // Reset webcam result text
    const webcamResult = document.getElementById('webcamResult');
    if (webcamResult) webcamResult.textContent = 'Show your hand ✋';
}

// Toggle webcam button
webcamToggleBtn.addEventListener("click", () => {
    if (stream) {
        stopWebcam();
        // Switch back to drawing mode
        document.querySelector('[data-mode="drawing"]').click();
    }
});

// Capture webcam frame to canvas
function captureWebcamFrame() {
    if (stream && video.readyState === video.HAVE_ENOUGH_DATA) {
        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = video.videoWidth;
        tempCanvas.height = video.videoHeight;
        const tempCtx = tempCanvas.getContext("2d");
        tempCtx.drawImage(video, 0, 0);
        
        // Resize to match drawing canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(tempCanvas, 0, 0, canvas.width, canvas.height);
    }
}

// Temporary recognition
document.getElementById("recognizeBtn").addEventListener("click", () => {
    // If webcam is active, capture the frame
    if (stream) {
        captureWebcamFrame();
    }
    
    // If gesture mode is active, copy gesture canvas to drawing canvas
    if (gestureMode) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(gestureCanvas, 0, 0);
    }
    
    document.getElementById("prediction").textContent = "Ready for AI";
    document.getElementById("confidence").style.width = "85%";
    document.getElementById("confidenceText").textContent = "85%";
    
    // Switch to prediction slide
    setTimeout(() => {
        showSlide("prediction");
    }, 500);
});

// Back to Drawing button
document.getElementById("backToDrawBtn").addEventListener("click", () => {
    showSlide("drawing");
});

// ============= GESTURE DETECTION SETUP =============
const gestureVideo = document.getElementById("gestureVideo");
const gestureCanvas = document.getElementById("gestureCanvas");
const gestureCtx = gestureCanvas.getContext("2d");
const gestureToggleBtn = document.getElementById("gestureToggleBtn");
let gestureStream = null;
let gestureMode = false;
let handsModule = null;
let camera = null;
let lastX = null;
let lastY = null;
let currentGesture = "none";
let lastGestureMessage = null;
let gestureMessageTimeout = null;

// Initialize MediaPipe Hands
async function initializeMediaPipe() {
    if (handsModule) return; // Already initialized
    
    const HandsClass = window.Hands;
    if (!HandsClass) {
        console.error("MediaPipe Hands not loaded yet. Retrying...");
        setTimeout(initializeMediaPipe, 500);
        return;
    }

    handsModule = new HandsClass({
        locateFile: (file) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
        }
    });
    
    handsModule.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.5
    });
    
    handsModule.onResults(onHandsResults);
}

// Process hand detection results
function onHandsResults(results) {
    // Clear canvas and draw video frame
    gestureCtx.clearRect(0, 0, gestureCanvas.width, gestureCanvas.height);
    
    // Draw flipped video frame
    gestureCtx.save();
    gestureCtx.scale(-1, 1);
    gestureCtx.translate(-gestureCanvas.width, 0);
    if (gestureVideo.readyState === gestureVideo.HAVE_ENOUGH_DATA) {
        gestureCtx.drawImage(gestureVideo, 0, 0, gestureCanvas.width, gestureCanvas.height);
    }
    gestureCtx.restore();
    
    // Draw hand landmarks and interpret finger-up gestures
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const hand = results.multiHandLandmarks[0];

        // Finger positions
        const thumbTip  = hand[4];
        const indexTip  = hand[8];
        const indexPIP  = hand[6];
        const middleTip = hand[12];
        const middlePIP = hand[10];
        const ringTip   = hand[16];
        const ringPIP   = hand[14];
        const pinkyTip  = hand[20];
        const pinkyPIP  = hand[18];

        // Check which fingers are raised (simple Y-axis comparison)
        const indexUp  = indexTip.y < indexPIP.y;
        const middleUp = middleTip.y < middlePIP.y;
        const ringUp   = ringTip.y < ringPIP.y;
        const pinkyUp  = pinkyTip.y < pinkyPIP.y;

        // --------------------------------
        // ☝️ 1. INDEX FINGER = DRAW
        // --------------------------------
        if (indexUp && !middleUp && !ringUp && !pinkyUp) {
            currentGesture = "draw";

            const x = (1 - indexTip.x) * canvas.width;
            const y = indexTip.y * canvas.height;

            if (lastX !== null && lastY !== null) {
                ctx.beginPath();
                ctx.moveTo(lastX, lastY);
                ctx.lineTo(x, y);
                ctx.strokeStyle = "black";
                ctx.lineWidth = 5;
                ctx.lineCap = "round";
                ctx.stroke();
            }

            lastX = x;
            lastY = y;
        }


        // --------------------------------
        // ✌️ 2. TWO FINGERS = ERASER
        // --------------------------------
        else if (indexUp && middleUp && !ringUp && !pinkyUp) {
            currentGesture = "erase";

            const x = (1 - indexTip.x) * canvas.width;
            const y = indexTip.y * canvas.height;

            if (lastX !== null && lastY !== null) {
                ctx.beginPath();
                ctx.moveTo(lastX, lastY);
                ctx.lineTo(x, y);
                ctx.strokeStyle = "white";
                ctx.lineWidth = 30;
                ctx.lineCap = "round";
                ctx.stroke();
            }

            lastX = x;
            lastY = y;
        }


        // --------------------------------
        // ✊ 3. FIST = CLEAR
        // --------------------------------
        else if (!indexUp && !middleUp && !ringUp && !pinkyUp) {
            currentGesture = "clear";

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            lastX = null;
            lastY = null;
        }


        // --------------------------------
        // 🖐️ 4. OPEN PALM = STOP
        // --------------------------------
        else if (indexUp && middleUp && ringUp && pinkyUp) {
            currentGesture = "stop";

            lastX = null;
            lastY = null;
        }


        // --------------------------------
        // UNKNOWN GESTURE
        // --------------------------------
        else {
            currentGesture = "none";
            lastX = null;
            lastY = null;
        }

        // Update on-screen gesture message (shows briefly when state changes)
        updateGestureMessage(currentGesture);

        // Draw landmarks and visualization as before
        const indexX = indexTip.x * gestureCanvas.width;
        const indexY = indexTip.y * gestureCanvas.height;
        const middleX = middleTip.x * gestureCanvas.width;
        const middleY = middleTip.y * gestureCanvas.height;
        const distance = Math.sqrt(Math.pow(indexX - middleX, 2) + Math.pow(indexY - middleY, 2));

        drawHandLandmarks(hand, indexX, indexY, distance);
        displayDetectionInfo(distance, results.multiHandedness?.[0]?.label || "Right");
    }
}

// Display real-time hand detection information
function displayDetectionInfo(pinchDistance, handedness) {
    // Show Hand Detected status at top
    gestureCtx.fillStyle = "rgba(0, 255, 100, 0.95)";
    gestureCtx.font = "bold 16px Arial";
    gestureCtx.fillRect(8, 10, 200, 28);
    gestureCtx.fillStyle = "#000";
    gestureCtx.fillText("✓ Hand Detected", 15, 30);
    
    // Show hand details
    gestureCtx.fillStyle = "rgba(212, 175, 55, 0.9)";
    gestureCtx.font = "bold 14px Arial";
    gestureCtx.fillText(`Hand: ${handedness}`, 10, 60);
    gestureCtx.fillText(`Distance: ${pinchDistance.toFixed(0)}px`, 10, 80);
    
    if (pinchDistance < 50) {
        gestureCtx.fillStyle = "rgba(0, 255, 0, 0.9)";
        gestureCtx.fillText("✓ Drawing Active", 10, 100);
    } else {
        gestureCtx.fillStyle = "rgba(255, 200, 100, 0.9)";
        gestureCtx.fillText("→ Ready to Draw", 10, 100);
    }
}

// Draw hand landmarks for visual feedback
function drawHandLandmarks(landmarks, indexX, indexY, distance) {
    const connections = window.HAND_CONNECTIONS || (window.Hands && window.Hands.HAND_CONNECTIONS) || [];
    gestureCtx.strokeStyle = "rgba(212, 175, 55, 0.5)";
    gestureCtx.lineWidth = 2;
    gestureCtx.fillStyle = "rgba(212, 175, 55, 0.8)";
    
    // Draw connections
    for (const connection of connections) {
        const start = landmarks[connection[0]];
        const end = landmarks[connection[1]];
        
        const startX = start.x * gestureCanvas.width;
        const startY = start.y * gestureCanvas.height;
        const endX = end.x * gestureCanvas.width;
        const endY = end.y * gestureCanvas.height;
        
        gestureCtx.beginPath();
        gestureCtx.moveTo(startX, startY);
        gestureCtx.lineTo(endX, endY);
        gestureCtx.stroke();
    }
    
    // Draw landmarks
    for (const landmark of landmarks) {
        const x = landmark.x * gestureCanvas.width;
        const y = landmark.y * gestureCanvas.height;
        
        gestureCtx.beginPath();
        gestureCtx.arc(x, y, 4, 0, 2 * Math.PI);
        gestureCtx.fill();
    }
    
    // Enhance visualization with finger tracking
    enhanceHandVisualization(landmarks);
    
    // Update FPS counter
    updateFPS();
}

// Start gesture control
async function startGesture() {
    try {
        // Initialize MediaPipe if not done yet
        await initializeMediaPipe();
        
        // Get webcam stream
        gestureStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "user" }
        });
        
        gestureVideo.srcObject = gestureStream;
        gestureMode = true;
        gestureToggleBtn.style.display = "inline-block";
        gestureToggleBtn.textContent = "🖐️ Stop Gesture";
        // Make the camera container floating and enable dragging
        const camContainer = document.querySelector('.gesture-camera-container');
        if (camContainer) {
            camContainer.classList.add('floating');
            // Reset any inline positioning
            camContainer.style.left = '';
            camContainer.style.top = '';

            let isDragging = false;
            let startX = 0;
            let startY = 0;
            let origX = 0;
            let origY = 0;

            const handle = camContainer.querySelector('.floating-handle') || camContainer;

            function onMouseDown(e) {
                isDragging = true;
                startX = e.clientX || (e.touches && e.touches[0].clientX);
                startY = e.clientY || (e.touches && e.touches[0].clientY);
                const rect = camContainer.getBoundingClientRect();
                origX = rect.left;
                origY = rect.top;
                // switch to left/top positioning for smoother drag
                camContainer.style.right = 'auto';
                camContainer.style.bottom = 'auto';
                camContainer.style.left = origX + 'px';
                camContainer.style.top = origY + 'px';
                window.addEventListener('mousemove', onMouseMove);
                window.addEventListener('touchmove', onMouseMove, { passive: false });
                window.addEventListener('mouseup', onMouseUp);
                window.addEventListener('touchend', onMouseUp);
            }

            function onMouseMove(e) {
                if (!isDragging) return;
                e.preventDefault();
                const clientX = e.clientX || (e.touches && e.touches[0].clientX);
                const clientY = e.clientY || (e.touches && e.touches[0].clientY);
                const dx = clientX - startX;
                const dy = clientY - startY;
                camContainer.style.left = origX + dx + 'px';
                camContainer.style.top = origY + dy + 'px';
            }

            function onMouseUp() {
                isDragging = false;
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('touchmove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
                window.removeEventListener('touchend', onMouseUp);
            }

            handle.addEventListener('mousedown', onMouseDown);
            handle.addEventListener('touchstart', onMouseDown, { passive: true });
            // store references so we can remove them later
            camContainer._dragCleanup = () => {
                handle.removeEventListener('mousedown', onMouseDown);
                handle.removeEventListener('touchstart', onMouseDown);
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('touchmove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
                window.removeEventListener('touchend', onMouseUp);
            };
        }
        
        // Wait for video to load, then start processing
        gestureVideo.onloadedmetadata = () => {
            // Match gesture canvas to incoming video size for accurate drawing
            gestureCanvas.width = gestureVideo.videoWidth || gestureCanvas.width;
            gestureCanvas.height = gestureVideo.videoHeight || gestureCanvas.height;
            // Start hand detection loop
            detectHands();
        };
    } catch (err) {
        console.error("Error accessing gesture webcam:", err);
        alert("Unable to access webcam for gesture control. Please check permissions.");
    }
}

// Hand detection loop
function detectHands() {
    if (!gestureMode || !handsModule) return;
    
    handsModule.send({ image: gestureVideo });
    requestAnimationFrame(detectHands);
}

// Stop gesture control
function stopGesture() {
    gestureMode = false;
    if (gestureStream) {
        gestureStream.getTracks().forEach(track => track.stop());
        gestureStream = null;
    }
    gestureToggleBtn.style.display = "none";
    undoBtn.style.display = "none";
    drawingHistory = []; // Clear history when stopping gesture
    gestureCtx.clearRect(0, 0, gestureCanvas.width, gestureCanvas.height);
    // Remove floating behavior and cleanup listeners
    const camContainer = document.querySelector('.gesture-camera-container');
    if (camContainer) {
        camContainer.classList.remove('floating');
        if (camContainer._dragCleanup) {
            camContainer._dragCleanup();
            delete camContainer._dragCleanup;
        }
        // clear inline positioning
        camContainer.style.left = '';
        camContainer.style.top = '';
        camContainer.style.right = '';
        camContainer.style.bottom = '';
    }
}

// Gesture stop button
gestureToggleBtn.addEventListener("click", () => {
    if (gestureMode) {
        stopGesture();
        // Switch back to drawing mode
        document.querySelector('[data-mode="drawing"]').click();
    }
});

// ============= ENHANCED REAL-TIME DETECTION =============
// Add visual feedback indicators for hand detection

// Visual feedback object
const detectionFeedback = {
    fps: 0,
    frameCount: 0,
    lastTime: performance.now(),
    isHandDetected: false,
    confidenceLevel: 0
};

// Calculate and display FPS
function updateFPS() {
    detectionFeedback.frameCount++;
    const currentTime = performance.now();
    if (currentTime - detectionFeedback.lastTime >= 1000) {
        detectionFeedback.fps = detectionFeedback.frameCount;
        detectionFeedback.frameCount = 0;
        detectionFeedback.lastTime = currentTime;
    }
}

// Enhanced hand landmarks with improved visualization
function enhanceHandVisualization(landmarks) {
    // Highlight index and middle fingers for pinch detection
    const indexTip = landmarks[8];
    const middleTip = landmarks[12];
    
    const indexX = indexTip.x * gestureCanvas.width;
    const indexY = indexTip.y * gestureCanvas.height;
    const middleX = middleTip.x * gestureCanvas.width;
    const middleY = middleTip.y * gestureCanvas.height;
    
    // Draw large cursor at index fingertip
    // Outer circle (glow effect)
    gestureCtx.strokeStyle = "rgba(0, 200, 255, 0.6)";
    gestureCtx.lineWidth = 3;
    gestureCtx.beginPath();
    gestureCtx.arc(indexX, indexY, 18, 0, 2 * Math.PI);
    gestureCtx.stroke();
    
    // Inner filled circle (cursor dot)
    gestureCtx.fillStyle = "rgba(0, 200, 255, 0.9)";
    gestureCtx.beginPath();
    gestureCtx.arc(indexX, indexY, 8, 0, 2 * Math.PI);
    gestureCtx.fill();
    
    // Draw crosshair at cursor
    gestureCtx.strokeStyle = "rgba(0, 200, 255, 0.8)";
    gestureCtx.lineWidth = 2;
    gestureCtx.setLineDash([3, 3]);
    gestureCtx.beginPath();
    gestureCtx.moveTo(indexX - 12, indexY);
    gestureCtx.lineTo(indexX + 12, indexY);
    gestureCtx.stroke();
    gestureCtx.beginPath();
    gestureCtx.moveTo(indexX, indexY - 12);
    gestureCtx.lineTo(indexX, indexY + 12);
    gestureCtx.stroke();
    gestureCtx.setLineDash([]);
    
    // Highlight middle finger
    gestureCtx.fillStyle = "rgba(255, 150, 100, 0.8)";
    gestureCtx.beginPath();
    gestureCtx.arc(middleX, middleY, 7, 0, 2 * Math.PI);
    gestureCtx.fill();
    
    // Draw line between fingers to visualize pinch distance
    gestureCtx.strokeStyle = "rgba(255, 100, 100, 0.5)";
    gestureCtx.lineWidth = 2;
    gestureCtx.setLineDash([4, 4]);
    gestureCtx.beginPath();
    gestureCtx.moveTo(indexX, indexY);
    gestureCtx.lineTo(middleX, middleY);
    gestureCtx.stroke();
    gestureCtx.setLineDash([]);
}

// Show a short on-screen message for gestures
function showGestureMessage(text, duration = 1200) {
    const el = document.getElementById('gestureMessage');
    if (!el) return;

    if (!text) {
        el.classList.remove('visible');
        lastGestureMessage = null;
        return;
    }

    el.textContent = text;
    el.classList.add('visible');

    if (gestureMessageTimeout) clearTimeout(gestureMessageTimeout);
    gestureMessageTimeout = setTimeout(() => {
        el.classList.remove('visible');
        gestureMessageTimeout = null;
        lastGestureMessage = null;
    }, duration);

    lastGestureMessage = text;
}

function updateGestureMessage(gesture) {
    const mapping = {
        draw: 'Draw',
        erase: 'Eraser',
        clear: 'Cleared',
        stop: 'Stop',
        none: ''
    };

    const text = mapping[gesture] || '';
    if (text === lastGestureMessage) return; // avoid repeating
    showGestureMessage(text);
}