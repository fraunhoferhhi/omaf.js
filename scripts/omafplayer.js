/* -----------------------------------------------------------------------------
Software License for The Fraunhofer OMAF Javascript Player (c) Copyright 1995-2019 Fraunhofer-Gesellschaft zur Förderung
der angewandten Forschung e.V. All rights reserved.

 1.    INTRODUCTION
The Fraunhofer OMAF Javascript Player ("OMAF Javascript Player") is software that implements the 
MPEG ISO/IEC 23090-2:2017 Omnidirectional Media Format ("OMAF") HEVC-based viewport-dependent OMAF video profile ("VDP")
for storage and distribution of VR360 video.

The Fraunhofer OMAF Javascript Player implementation consists of:
1. JavaScript Player (source code)
2. Content Creation Tools omaf-file-creation (python script + binaries)

The VDP Profile of the MPEG-OMAF standard allows distribution of VR360 video with higher resolution compared to encoding
the whole VR360 video in a single stream. The VDP Profile spatially segments the video into HEVC tiles and packaging the
tiles in a way that the receiver can request the high-definition tiles for the user‘s viewport and low-definition tiles 
for the areas out of sight. At the receiver the tiles are aggregated into a single HEVC compliant video stream that can 
be decoded with a legacy HEVC video decoder and rendered to the screen.

2.    COPYRIGHT LICENSE
Redistribution and use in source or binary forms for purpose of testing the OMAF Javascript Player, with or without 
modification, are permitted without payment of copyright license fees provided that you satisfy the following 
conditions: 

You must retain the complete text of this software license in redistributions of the OMAF Javascript Player or your 
modifications thereto in source code form. 
  
You must make available free of charge copies of the complete source code of the OMAF Javascript Player and your 
modifications thereto to recipients of copies in binary form. The name of Fraunhofer may not be used to endorse or 
promote products derived from this library without prior written permission. 

You may not charge copyright license fees for anyone to use, copy or distribute the OMAF Javascript Player software or 
your modifications thereto. 

Your modified versions of the OMAF Javascript Player must carry prominent notices stating that you changed the software 
and the date of any change. For modified versions of the OMAF Javascript Player, the term 
"Fraunhofer OMAF Javascript Player" must be replaced by the term 
"Third-Party Modified Version of the Fraunhofer OMAF Javascript Player.".

3.    NO PATENT LICENSE
NO EXPRESS OR IMPLIED LICENSES TO ANY PATENT CLAIMS, including without limitation the patents of Fraunhofer, 
ARE GRANTED BY THIS SOFTWARE LICENSE.
Fraunhofer provides no warranty of patent non-infringement with respect to this software.
You may use this OMAF Javascript Player or modifications thereto only for purposes that are authorized by appropriate 
patent licenses.

4.    DISCLAIMER
This OMAF Javascript Player software is provided by Fraunhofer on behalf of the copyright holders and contributors 
"AS IS" and WITHOUT ANY EXPRESS OR IMPLIED WARRANTIES, including but not limited to the implied warranties of 
merchantability and fitness for a particular purpose. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE 
for any direct, indirect, incidental, special, exemplary, or consequential damages, including but not limited to 
procurement of substitute goods or services; loss of use, data, or profits, or business interruption, however caused and
on any theory of liability, whether in contract, strict liability, or tort (including negligence), arising in any way 
out of the use of this software, even if advised of the possibility of such damage.

5.    CONTACT INFORMATION
Fraunhofer Heinrich Hertz Institute
Attention: Video Coding & Analytics department – Multimedia Communications
Einsteinufer 37
10587 Berlin, Germany
www.hhi.fraunhofer.de/OMAF
omaf@hhi.fraunhofer.de
----------------------------------------------------------------------------- */

function OMAFPlayer () {
    this.version        = "0.1.0"; // change it every time we push to master or create a new tag

    this.initialized    = false;
    this.isOninit       = false;
    this.isOnLoop       = true;
    this.isReset        = false;
    this.isOnMainVid    = true; 

    this.MP = null; // Manifest Parser
    this.ME = null; // Media Engine
    this.DL = null; // DownLoader
    this.RE = null; // REnderer

    this.segmentNr = 1;
    this.yaw       = 0;
    this.pitch     = 0;
    this.preTrackID     = 0;
    this.preYaw         = 0;
    this.prePitch       = 0;
    this.tIdCount       = 1;
    this.segDifArr      = [];
    this.isAddDif       = false;
    this.mainBufReq     = null;
    this.pauseReq       = null;

    this.vidElement = null;
    this.renderElement = null;
    this.cameraElement  = null;
    this.videoController = null;
    this.videoControllerVisibleTimeout = 0;
    this.mouseMoveHandler = null;
    this.readyInitRender    = false;
    this.readyMainRender    = false;

    
    this.lastSegNum     = 0;   
    this.segmentDuration = null;
    this.bufferLimitTime = null;
    this.bufferOffsetTime = 0;

    this.isPlaying    = false;  // for now its just 2 states: playing and not playing
    this.onInit       = null;
}

OMAFPlayer.prototype.getVersion = function(){
    return this.version;
}

OMAFPlayer.prototype.setRenderDebugInfo = function(flag){ 
    if(this.RE){
        this.RE.setDebug(flag);
    }
}

OMAFPlayer.prototype.init = function(vidElement, renderElement,cameraElement){
    if (this.initialized){
        Log.warn("Player", "OMAF Player was already initialized.");
        return;
    }
    var self = this;
    
    // create modules
    this.MP = new MPDParser();
    this.ME = new MediaEngine();
    this.DL = new Fetcher();
    this.RE = new Renderer();
    this.SE = new scheduler();

    Log.info("Player", "init OMAF Player");
    
    this.vidElement = vidElement;
    this.renderElement = renderElement;
    this.cameraElement = cameraElement;
    this.renderElement.style.zIndex = "10";

    this.bufferLimitTime = 4000;
    this.vidElement.loop = true;
    
    
    if (/Edge/.test(navigator.userAgent)) {
        $("#modalMessage").html("Edge browser can't switch track. <br>For more details, You can refer to README.md");
        $("#warningPopup").modal(); 
    }
   
    
    this.SE.activeVideoElement = function(active, segNum) {
        
        this.activeBuffer = active;
        
        if(this.activeBuffer == "MASTER"){
            this.activeVidElement = self.vidElement;
            self.bufferOffsetTime = segNum * self.segmentDuration;
            this.setNewBufferOffsetTime(self.bufferOffsetTime);
        }else {
            Log.error("Player","Active buffer type not configured yet " + this.activeBuffer);
        }

        Log.info("Player","Active buffer type: " + this.activeBuffer );
        return;
    }

    document.addEventListener("webkitfullscreenchange", function() {
        if (document.webkitIsFullScreen){
            if(self.isPlaying){
                self.isEnterFullscreen = true;
                if(self.isOnMainVid){  
                    self.vidElement.pause();
                }
            }
        }
    });

    this.vidElement.onpause = function() {
        if(self.isPlaying && self.isEnterFullscreen ){
            self.isEnterFullscreen = false;
            var timeDif = 100;
            var preVidTime = parseInt(self.vidElement.currentTime * 1000);
            if(self.isOnMainVid){
                self.pauseReq = setInterval(function (){
                    if( (parseInt(self.vidElement.currentTime * 1000) >= preVidTime + timeDif) || self.isReset){
                        clearInterval(self.pauseReq);
                    }else{ 
                        self.vidElement.play();
                    }
                },timeDif);
            }
        }
    }
  
    this.vidElement.oncanplay = function() {
        if(!self.readyInitRender){
            self.SE.activeVideoElement("MASTER",0);
            self.RE.animate();
            self.readyInitRender = true;
            self.isOnMainVid = true;
        }
        self.readyMainRender = true;
    }
    
    this.videoController = document.getElementById('videoController');

    this.DL.onManifestLoaded = function (mpd) { self.MP.init(mpd); }
    this.DL.onInitLoaded = function (data) { 
        self.ME.init(self.vidElement, self.MP.getMimeType(), self.lastSegNum, data); 
    }
    this.DL.onMediaLoaded = function (data, segNum) { self.ME.processMedia(data,segNum); }

    this.MP.onInit = function () {
        var initURLs = self.MP.getVPinitSegURLs();
        self.lastSegNum = parseInt(self.MP.getLastSegmentNr());
        Log.info("Player", "Fetch init urls");
        self.DL.loadInitSegments(initURLs);
    }

    this.ME.onInit = function () {
        Log.info("Player", "MediaEngine is ready, now initialize the renderer");
        var fps = self.MP.getFPS();
        if (!fps) {
          fps = 30; // for now force set to 30
        }
        var framesPerSegment = self.MP.getFramesPerSegment(fps);

        self.segmentDuration = parseInt(framesPerSegment*1000/fps).toFixed(2);
    
        var RWPKs = self.ME.getRWPKs();

        var SRQRs = self.ME.getSRQRs(); // get best region vectors 
        // todo: use it to compare with metadata from MPD

        var mpdRegionVectors = self.MP.getBestRegionVectors();
    
        // initialize the renderer
        self.RE.init(self.MP.getProjection(),
            self.vidElement, 
            self.renderElement, 
            self.cameraElement, 
            fps, 
            framesPerSegment, 
            RWPKs, 
            mpdRegionVectors);
    }
        
    this.RE.onInit = function () {
        self.SE.init(self.vidElement, "MASTER");
        self.loadNextSegment(); // load first segment after init
    }

    this.ME.onMediaProcessed = function () {
        // this is where whe know that sourceBuffer has received our stuff
        // requires logic to manage buffers based on segment number
        Log.info("Player", "MediaEngine processed all media segments.");
        loadingDone = false;

        const loadBuffer = () => {
            while ( !self.isBufferFullyLoaded() && !loadingDone) {
                    self.fillMyBuffer();
                    loadingDone = true;
            }
            return true;
        }
        if(!self.isPlaying) { 
            loadBuffer(); 
        }
        else{ 
            self.fillMyBuffer();
        }
    }
   
    
    if (document.addEventListener)
    {
        document.addEventListener('webkitfullscreenchange', self.exitHandler.bind(self), false);
        document.addEventListener('mozfullscreenchange', self.exitHandler.bind(self), false);
        document.addEventListener('fullscreenchange', self.exitHandler.bind(self), false);
        document.addEventListener('MSFullscreenChange', self.exitHandler.bind(self), false);
    }

    this.mouseMoveHandler = self.onFullScreenMouseMove.bind(self);

    this.initialized = true;
   
    if(!this.isOninit){
        Log.warn("Player","onInit");
        this.onInit();
        this.isOninit = true;
    }
}

OMAFPlayer.prototype.start = function(strMPD){
    Log.info("Player", "Start playback of: " + strMPD);
    this.DL.loadManifest(strMPD);
}

OMAFPlayer.prototype.isBufferFullyLoaded = function() {
    self = this;
    curTime = (self.SE.getCurrentTime());
    bufferAvailable = ( parseInt(self.ME.currentSegNum)*self.segmentDuration) - curTime; 
    Log.info("Player"," buffer full last buffered segment  " + self.ME.currentSegNum );
    Log.info("Player"," segment playbacked  " + ((curTime/self.segmentDuration) ).toFixed(0) );
 
    if( (bufferAvailable + parseInt(self.segmentDuration) ) > (self.bufferLimitTime) )
    {   Log.info("Player"," Buffer is fully loaded" ); 
        return true;
    } else { 
        Log.info("Player"," Buffer is not fully loaded")        
        return false;
    }
}
 
OMAFPlayer.prototype.fillMyBuffer = function() {
    self = this;
    curTime = (self.SE.getCurrentTime());

    bufferAvailable = ( parseInt(self.ME.currentSegNum)*self.segmentDuration) - curTime; 
    // Log.info("Player"," last buffered segment  " + self.ME.currentSegNum );
    // Log.info("Player"," segment playbacked  " + ((curTime/self.segmentDuration) ).toFixed(0) );
    // Log.info("Player","duration of buffered content available : " + bufferAvailable + "ms");
    
    if( (bufferAvailable + parseInt(self.segmentDuration) ) > (self.bufferLimitTime) ){
        decisionOffset  =  (bufferAvailable + parseInt(self.segmentDuration) ) - (self.bufferLimitTime);
        // self.SE.BufferFull = true;
        //Log.warn("Player","Next segment can not be accomodated in the buffer. The request will be made in :" + decisionOffset + "ms ");
        setTimeout(function(){
            self.loadNextSegment();
        }, decisionOffset);
    }
    else {
        Log.info("Player","Buffer is not full yet");
        self.loadNextSegment();
        // self.SE.BufferLoaded = false;
    }
}


OMAFPlayer.prototype.play = function(){
    if(this.isPlaying){
        Log.info("Player", "Playback is already running");
        return;
    }
    if(this.isOnMainVid){
        Log.warn("isOnMainVid play");
        this.vidElement.play();
    }
    this.isPlaying = true;
    this.fillMyBuffer();
}

OMAFPlayer.prototype.pause = function(){
    if(this.isOnMainVid){
        Log.warn("isOnMainVid pause");
        this.vidElement.pause();
    }
    this.isPlaying = false;
    Log.info("Player", "Playback has been paused");
}

//for esc button on the keyboard
OMAFPlayer.prototype.exitHandler = function(){
    if (this.isFullscreen()) {
        this.enterFullscreen();  
    } else {
        this.exitFullscreen();  
    }
}

OMAFPlayer.prototype.changeFullScreen = function(){
    if (!this.isFullscreen()) {
        this.enterFullscreen();  
    } else {
        this.exitFullscreen();  
    }
}

OMAFPlayer.prototype.isFullscreen = function () {
   return document.fullscreenElement || document.msFullscreenElement || document.mozFullScreen || document.webkitIsFullScreen;
}

OMAFPlayer.prototype.enterFullscreen = function () {
    var self = this;
    var element = document.getElementById('videobox');
    
    if (element.requestFullscreen) {
        element.requestFullscreen();
    } else if (element.msRequestFullscreen) {
        element.msRequestFullscreen();
    } else if (element.mozRequestFullScreen) {
        element.mozRequestFullScreen();
    } else {
        element.webkitRequestFullScreen();
    }

    this.videoController.classList.add('video-controller-fullscreen');
    window.addEventListener("mousemove", self.mouseMoveHandler);
    this.onFullScreenMouseMove();
}

OMAFPlayer.prototype.onFullScreenMouseMove = function () {
    var self = this;
    self.clearFullscreenState();
    self.videoControllerVisibleTimeout = setTimeout(function () {
        self.videoController.classList.add("hide");
    }, 4000);
}

OMAFPlayer.prototype.clearFullscreenState = function () {
    clearTimeout(this.videoControllerVisibleTimeout);
    this.videoController.classList.remove("hide");
}

OMAFPlayer.prototype.exitFullscreen = function () {
    var self = this;
    window.removeEventListener("mousemove", self.mouseMoveHandler);
    this.clearFullscreenState();

    if (document.exitFullscreen) {
        document.exitFullscreen();
    } else if (document.mozCancelFullScreen) {
        document.mozCancelFullScreen();
    } else if (document.msExitFullscreen) {
        document.msExitFullscreen();
    } else {
        document.webkitCancelFullScreen();
    }
    this.videoController.classList.remove('video-controller-fullscreen');
}

OMAFPlayer.prototype.loadNextSegment = function(){
    var pos = this.RE.getOMAFPosition();
    this.yaw = pos.phi;
    this.pitch = pos.theta;
    var asID = this.MP.getASIDfromYawPitch(this.yaw, this.pitch);
    this.trackID = this.ME.getTrackIDFromASID(asID);
    
    if(this.segmentNr == 1){
        if(this.isReset){
            this.trackID = this.preTrackID;
            this.yaw = this.preYaw;
            this.pitch = this.prePitch;
        }
        this.RE.matchTracktoCube(this.trackID);
    }else{
        this.trackID = this.preTrackID;
        this.yaw = this.preYaw;
        this.pitch = this.prePitch;
        this.tIdCount++;
    }
    var mediaURLs = this.MP.getMediaRequestsSimple(this.yaw, this.pitch, this.segmentNr);
    
    this.preTrackID = this.trackID;
    this.preYaw = this.yaw;
    this.prePitch = this.pitch;
    Log.info("Extractor Track ID : ", this.trackID);
    if (this.ME.setActiveTrackID(this.trackID, this.segmentNr)) {
        this.DL.loadMediaSegments(mediaURLs, (this.segmentNr++));
    }
}

OMAFPlayer.prototype.getMetrics = function(){
    var metrics = {};
    if(this.RE.initialized){
        var pos = this.RE.getOMAFPosition();
        metrics["yaw"] = THREE.Math.radToDeg(pos.phi);
        metrics["pitch"] = THREE.Math.radToDeg(pos.theta);
    } else{
        metrics["yaw"] = this.yaw;
        metrics["pitch"] = this.pitch;
    }
    metrics["trackID"] = this.trackID;
    metrics["segNr"] = this.segmentNr;
    return metrics;
}



OMAFPlayer.prototype.reset = function(){
    
    if(this.initialized){
        this.DL.reset();
        this.ME.reset(false);
        this.MP.reset();
        this.RE.reset();
        delete this.DL;
        delete this.ME;
        delete this.MP;
        delete this.RE;
    
        delete this.videoController;
        delete this.mouseMoveHandler;
        delete this.segDifArr;
        clearTimeout(this.videoControllerVisibleTimeout);
        clearInterval(self.mainBufReq);
        clearInterval(self.pauseReq);
        
        this.segmentNr      = 1;
        this.tIdCount       = 1;
        this.segDifArr      = [];
        this.isAddDif       = false;

        this.bufferOffsetTime = 0;

        this.isPlaying = false;
        this.readyInitRender = false; 
        this.initialized = false;
        this.readyMainRender = false;
    }
}

OMAFPlayer.prototype.loop = function(element){
    if(this.isOnLoop){
        $(element).removeClass('fa-repeat').addClass('fa-long-arrow-right ');
        this.isOnLoop = false;
        this.vidElement.loop = false;
        
    }else{
        $(element).removeClass('fa-long-arrow-right').addClass('fa-repeat ');
        this.isOnLoop = true;
        this.vidElement.loop = true;
    }
}
 