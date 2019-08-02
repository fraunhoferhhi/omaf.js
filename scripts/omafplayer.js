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
    this.version        = "0.1.2"; // change it every time we push to master or create a new tag

    this.initialized    = false;
    this.isOninit       = false;
    this.isOnLoop       = true;
    this.isLastBuf      = false;
    this.isReset        = false;
    this.isOnMainVid    = true;
    this.isFirstSwitch  = false;
    this.isTrackSwitch  = false;
    this.isEnterFullscreen = false;
    this.isFirstsegment = true;
    this.isPushChangeVP = false;

    this.MP = null; // Manifest Parser
    this.ME = null; // Media Engine
    this.DL = null; // DownLoader
    this.RE = null; // REnderer
    this.MT = null;

    this.segmentNr = 1;
    this.yaw       = 0;
    this.pitch     = 0;
    this.preTrackID     = 0;
    this.preYaw         = 0;
    this.prePitch       = 0;
    this.tIdCount       = 1;
    this.segDifArr      = [];
    this.retryTimeMs    = 100;
    this.retryReqNum    = 1;
    this.elapasedTime   = 0;
    this.displayHZ      = 0;
    this.isAddDif       = false;
    this.mainBufReq     = null;
    this.subBufReq      = null;
    this.pauseReq       = null;
    this.metricsReq     = null;
    this.maxDifSegNum   = 0;
    this.recentChangedSegNum    = 0;
    this.longestMediaTimeMS     = 0;
    this.firstTrackID   = null;  
    this.fovH           = 0;
    this.fovV           = 0;
    this.renderedTrackID        = 0;
    this.renderedPreTrackID     = 0;
    this.userViewTrackID        = 0;
    this.userChangeVPList       = [];
    this.userChangeVPID         = 0;
    

    this.vidElement = null;
    this.subVidElement  = null;
    this.renderElement = null;
    this.subRenderElemet = null;
    this.cameraElement  = null;
    this.videoController = null;
    this.videoControllerVisibleTimeout = 0;
    this.mouseMoveHandler = null;
    this.readyInitRender    = false;
    this.readyMainRender    = false;
    this.readySubRender    = false;

    this.switchInfoQ = new Queue;
    this.requestNextSegQ = new Queue;
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

OMAFPlayer.prototype.setTrackSwitch = function(flag){ 
    this.isTrackSwitch = flag;
}

OMAFPlayer.prototype.init = function(vidElement, subVidElement, renderElement, subRenderElement, cameraElement, bufferLimit){
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
    this.MT = new Metrics();

    Log.info("Player", "init OMAF Player");
    
    self.bufferLimitTime = parseInt(bufferLimit);

    this.vidElement = vidElement;
    this.subVidElement = subVidElement;

    this.renderElement = renderElement;
    this.subRenderElement = subRenderElement;
    this.cameraElement = cameraElement;
    this.renderElement.style.zIndex = "10";
    this.subRenderElement.style.zIndex = "8";
    this.SE.activeVideoElement = function(active, segNum) {
        
        this.activeBuffer = active;
        
        if(this.activeBuffer == "MASTER"){
            this.activeVidElement = self.vidElement;
            self.bufferOffsetTime = segNum * self.segmentDuration;
            this.setNewBufferOffsetTime(self.bufferOffsetTime);
        }
        else if(this.activeBuffer == "SLAVE"){
            this.activeVidElement = self.subVidElement;
            self.bufferOffsetTime = segNum * self.segmentDuration;
            this.setNewBufferOffsetTime(self.bufferOffsetTime);
        }   
        else {
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
                }else{
                    self.subVidElement.pause();
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

    this.subVidElement.onpause = function() {
        
        if(self.isPlaying && self.isEnterFullscreen){
            self.isEnterFullscreen = false;
            var timeDif = 100;
            var preVidTime = parseInt(self.subVidElement.currentTime * 1000);
            if(!self.isOnMainVid){
                self.pauseReq = setInterval(function (){
                    if( (parseInt(self.subVidElement.currentTime * 1000) >= preVidTime + timeDif) || self.isReset){
                        clearInterval(self.pauseReq);
                    }else{
                        self.subVidElement.play();
                    }
                },timeDif);
            }
        }
    }  
    
    this.vidElement.onwaiting = function() {
        if(self.vidElement.buffered.length){
            self.checkSubBuffer(self.vidElement.currentTime);
        }     
    }

    this.vidElement.onended = function() {
        if(self.vidElement.buffered.length){
            self.checkSubBuffer(self.vidElement.currentTime);
        }
    }

    this.vidElement.oncanplay = function() {
        if(self.isReset){
            clearInterval(self.mainBufReq);
            clearInterval(self.subBufReq);
            clearInterval(self.pauseReq);
            self.userChangeVPList   = [];
            self.userChangeVPID = 0;
            //clearInterval(self.metricsReq);
            self.vidElement.play();
            self.RE.mainRenderVideo();
            self.renderElement.style.zIndex = "10";
            self.subRenderElement.style.zIndex = "8";
            self.RE.readyToChangeTrack(false);
            self.RE.setIsAniPause(false);
            self.maxDifSegNum   = 0;
            self.recentChangedSegNum    = 0;
            self.longestMediaTimeMS     = 0;
            self.MT.reset();
            self.isReset = false;
            self.isOnMainVid = true;   
        }
        self.readyMainRender = true;
    }

    this.subVidElement.onwaiting = function() {
        if(self.subVidElement.buffered.length){
            self.checkMainBuffer(self.subVidElement.currentTime);
        }
    }

    this.subVidElement.oncanplay = function() {
        if(!self.readyInitRender){
            //self.SE.activeVideoElement("MASTER",0);
            self.RE.animate();
            self.ME.removeBuf(true, false);
            self.readyInitRender = true;
            self.isOnMainVid = true;
        }else{
            self.readySubRender = true;
        }
    }

    this.subVidElement.onended = function() {
        if(self.subVidElement.buffered.length){
            self.checkMainBuffer(self.subVidElement.currentTime);
        }
    }
    
    this.videoController = document.getElementById('videoController');

    this.DL.onManifestLoaded = function (mpd) { self.MP.init(mpd); }
    this.DL.onInitLoaded = function (data) { 
        self.retryReqNum = 1;
        self.ME.init(self.vidElement, self.subVidElement, self.MP.getMimeType(), self.lastSegNum, data); 
    }
    this.DL.onMediaLoaded = function (data, segNum) { self.ME.processMedia(data,segNum); }

    this.DL.onInitRequestFail = function () {
        if(self.retryReqNum == 10){
            ErrorPopUp("Can't download InitSegment");
            return;
        }
        var initURLs = self.MP.getVPinitSegURLs();
        self.retryReqNum ++;
        setTimeout(function(){
            self.DL.loadInitSegments(initURLs);
        }, self.retryTimeMs * self.retryReqNum);
    }

    this.DL.onMediaRequestFail = function (SegNum) {
        if(self.retryReqNum == 10){
            ErrorPopUp("Can't download MediaSegment");
            return;
        }
      
        self.segmentNr = SegNum;
        self.retryReqNum++;
        self.fillMyBuffer();
    }

    this.MP.onInit = function () {
        var initURLs = self.MP.getVPinitSegURLs();
        self.segmentNr = self.MP.getFirstSegmentNr();
        var initSegNum = self.segmentNr - 1;
        if(initSegNum < 0){
            initSegNum = 0;
        }
        self.SE.activeVideoElement("MASTER",initSegNum);
        //self.segmentNr = 90;
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
            self.subVidElement, 
            self.renderElement, 
            self.subRenderElement, 
            self.cameraElement, 
            fps, 
            framesPerSegment, 
            RWPKs, 
            mpdRegionVectors);
    }
        
    this.RE.onInit = function () {
        self.SE.init(self.vidElement, "MASTER");
        var resolution = $(self.renderElement).width() + " x " + $(self.renderElement).height();
        self.fovH = this.getFovH();
        self.fovV = this.getFovV();
        self.MT.init(self.fovH,self.fovV,resolution);
        
        self.loadNextSegment(); // load first segment after init
        
    }
    this.RE.onSwitchRender = function (isSub) {
        if(!isSub){
            self.vidElement.play();
            self.renderElement.style.zIndex = "10";
            self.subRenderElement.style.zIndex = "8";
        }else{
            self.subVidElement.play();
            self.renderElement.style.zIndex = "8";  
            self.subRenderElement.style.zIndex = "10";
        }
    }
    this.RE.onChangeResolution = function (width, height) {
        var resolution = width + " x " + height;
        self.MT.updateResolution(resolution);
    }

    this.RE.onCheckUserViewport = function () {
        var pos = self.RE.getOMAFPosition();
        var yaw = pos.phi;
        var pitch = pos.theta;
        var asID = self.MP.getASIDfromYawPitch(yaw,pitch);
        var curTrackID = self.ME.getTrackIDFromASID(asID);
       
        if (self.userViewTrackID !== curTrackID){ 
            var viewportInfo = {yaw: yaw, pitch: pitch, trackID: curTrackID, mediaTime: self.SE.getCurrentTime()}
            self.userChangeVPList.push(viewportInfo);
            self.userViewTrackID = curTrackID;
        }
        if(self.isPushChangeVP){
            var reqTime = self.requestNextSegQ.front().mediaTime;
            var firstVP, secondVP;
            var isAddfirstVP = false;
            var switchingTime = 0;
            
            for( var i = self.userChangeVPID ; i < self.userChangeVPList.length ; i++){
                if(self.userChangeVPList[i].mediaTime < reqTime){
                    if(!isAddfirstVP){
                        firstVP = new ViewportDataType(self.userChangeVPList[i].trackID, parseInt(THREE.Math.radToDeg(self.userChangeVPList[i].yaw) * 65536),
                                            parseInt(THREE.Math.radToDeg(self.userChangeVPList[i].pitch) * 65536), 0 ,
                                            parseInt(self.fovH * 65536), parseInt(self.fovV * 65536));
                        switchingTime = self.userChangeVPList[i].mediaTime;
                        isAddfirstVP = true;
                        
                    }
                    self.userChangeVPID = i + 1;
                }else{
                    self.userChangeVPID = i;
                    break;
                }
            }
            
            secondVP = new ViewportDataType(curTrackID, parseInt(THREE.Math.radToDeg(yaw) * 65536),
                                parseInt(THREE.Math.radToDeg(pitch) * 65536), 0 ,
                                parseInt(self.fovH * 65536), parseInt(self.fovV * 65536));
            var latency = self.SE.getCurrentTime() - switchingTime;
            var reason = [resonEnum.SEGMENT_DURATION, resonEnum.BUFFER_FULLNESS];
            if(firstVP){
                self.MT.updateCQViewportSwitchingLatency(new CQViewportSwitchingLatency(firstVP, secondVP, 1, 1, switchingTime, latency, reason));
            }
            self.requestNextSegQ.dequeue();
            self.isPushChangeVP = false;
        }
        //self.MP.getIsUserVPOutOfHQ(self.renderedTrackID, userYaw, userPitch, self.fovH, self.fovV);
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
    
    this.ME.onSwitchTrack = function(trackID, segNum, difSegNum, preTrackID){
        var switchObj = {
            trackID: trackID,
            segNum: segNum,
        };
        self.switchInfoQ.enqueue(switchObj);
  
        self.RE.setSwitch(true);

        if(!self.isAddDif){
            self.RE.setMaxCurTime((difSegNum * self.segmentDuration) / 1000);
            self.isAddDif = true;
        }else{
            self.segDifArr.push(((difSegNum * self.segmentDuration) / 1000));
        }
        var curMediaTime = self.SE.getCurrentTime();
        var mediaViewport = null;
        var startTime = 0;
        var initSegNum = self.MP.getFirstSegmentNr() - 1;
        if(initSegNum < 0){
            initSegNum = 0;
        }
        var bufMediaTime = ((parseInt(self.ME.downloadedSegNum) + initSegNum)*self.segmentDuration) - curMediaTime;
        if(self.maxDifSegNum === 0){ // first track change
            if(self.MT.renderedViewportList.length === 0){
                if(self.MP.getFirstSegmentNr() > 1){ // in case of live
                    startTime = (curMediaTime + bufMediaTime) - difSegNum * self.segmentDuration;
                }
                self.longestMediaTimeMS = difSegNum * self.segmentDuration;
                mediaViewport = self.MP.getMediaVP(self.firstTrackID);
                self.MT.updateLongestRenderedViewport(startTime, self.longestMediaTimeMS, mediaViewport);
            }
            self.maxDifSegNum = difSegNum;
        }else{
            if(self.maxDifSegNum < difSegNum){
                startTime = (curMediaTime + bufMediaTime) - difSegNum * self.segmentDuration;
                self.longestMediaTimeMS = difSegNum * self.segmentDuration;
                mediaViewport = self.MP.getMediaVP(preTrackID);
                self.MT.updateLongestRenderedViewport(startTime, self.longestMediaTimeMS, mediaViewport);
                self.maxDifSegNum = difSegNum;
            }
        }
        self.recentChangedSegNum = segNum + initSegNum;
    }

    this.ME.onSwitchGeometry = function(trackID, isSub){
        if(!isSub){
            self.RE.matchTracktoCube(trackID);
        }else{
            self.RE.subMatchTracktoCube(trackID);
        }
    }

    this.ME.onFinish = function(){
        self.isLastBuf = true;
    }

    this.ME.onReset = function(){
        self.loadNextSegment();
    }

    this.MT.onCheckRecentRenderedViewport = function(renderedViewportList){
        var curMediaTime = self.SE.getCurrentTime();
        var mediaViewport = null;
        var startTime = 0;
        var initSegNum = self.MP.getFirstSegmentNr() - 1;
        if(initSegNum < 0){
            initSegNum = 0;
        }
        var bufMediaTime = ((parseInt(self.ME.downloadedSegNum) + initSegNum)*self.segmentDuration) - curMediaTime;
        if(curMediaTime > self.MP.getFirstSegmentNr() * self.segmentDuration){   
            if(renderedViewportList.length === 0){
                if(self.MP.getFirstSegmentNr() > 1){
                    startTime = (curMediaTime + bufMediaTime) - self.ME.downloadedSegNum * self.segmentDuration; 
                }
                self.longestMediaTimeMS = (curMediaTime + bufMediaTime) - (initSegNum * self.segmentDuration);
                mediaViewport = self.MP.getMediaVP(self.firstTrackID);
                self.MT.updateLongestRenderedViewport(startTime, self.longestMediaTimeMS, mediaViewport);
            }else{
                var lastVP = renderedViewportList[renderedViewportList.length - 1];
                var elapsedTime;
                if(self.maxDifSegNum === 0){ // still on the first viewport
                    elapsedTime = (curMediaTime + bufMediaTime)- lastVP.startTime; //use 'lastVP.startTime' for calculating live time
                    self.longestMediaTimeMS = elapsedTime;
                    self.MT.updateLongestRenderedViewport(lastVP.startTime, self.longestMediaTimeMS, lastVP.viewport);
                }else{
                    startTime = self.recentChangedSegNum * self.segmentDuration;
                    elapsedTime = (curMediaTime + bufMediaTime) - startTime;
                    if(self.maxDifSegNum * self.segmentDuration < elapsedTime){
                        self.longestMediaTimeMS = elapsedTime;
                        self.MT.updateLongestRenderedViewport(startTime, self.longestMediaTimeMS, lastVP.viewport);
                    }
                }           
            }
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
    var initSegNum = self.MP.getFirstSegmentNr() - 1;
    if(initSegNum < 0){
        initSegNum = 0;
    }
    bufferAvailable = ((parseInt(self.ME.downloadedSegNum) + initSegNum)*self.segmentDuration) - curTime; 
    Log.info("Player"," buffer full last buffered segment  " + self.ME.downloadedSegNum );
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
    var initSegNum = self.MP.getFirstSegmentNr() - 1;
    if(initSegNum < 0){
        initSegNum = 0;
    }
    bufferAvailable = ((parseInt(self.ME.downloadedSegNum) + initSegNum)*self.segmentDuration) - curTime; 
    
    if( (bufferAvailable + parseInt(self.segmentDuration) ) > (self.bufferLimitTime) ){
        decisionOffset  =  (bufferAvailable + parseInt(self.segmentDuration) ) - (self.bufferLimitTime);
        // self.SE.BufferFull = true;
        //Log.warn("Player","Next segment can not be accomodated in the buffer. The request will be made in :" + decisionOffset + "ms ");
        setTimeout(function(){
            self.loadNextSegment();
        }, decisionOffset);
    }
    else {
        setTimeout(function(){
            self.loadNextSegment();
        },self.retryTimeMs * self.retryReqNum);
    }
}

OMAFPlayer.prototype.setBufferLimit = function(bufferLimit) {
    this.bufferLimitTime = parseInt(bufferLimit);
    Log.info("Player" ,"Buffer time " + this.bufferLimitTime + "ms");
}

OMAFPlayer.prototype.play = function(){
    if(this.isPlaying){
        Log.info("Player", "Playback is already running");
        return;
    }
    if(this.isOnMainVid){
        this.vidElement.play();
    }else{
        this.subVidElement.play();
    }
    this.isPlaying = true;
    this.fillMyBuffer();
}

OMAFPlayer.prototype.pause = function(){
    if(this.isOnMainVid){
        this.vidElement.pause();
    }else{
        this.subVidElement.pause();
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
   
    if(this.isFirstsegment){
        if(this.isReset){
            this.trackID = this.preTrackID;
            this.yaw = this.preYaw;
            this.pitch = this.prePitch;
        }
        this.RE.matchTracktoCube(this.trackID);
        this.RE.subMatchTracktoCube(this.trackID);
        this.renderedTrackID = this.trackID;
        this.userViewTrackID = this.trackID;
        this.isFirstsegment = false;
        this.firstTrackID = this.trackID;
    }else if(!this.isTrackSwitch){
        this.trackID = this.preTrackID;
        this.yaw = this.preYaw;
        this.pitch = this.prePitch;
        this.tIdCount++;
    }else{
        if( this.tIdCount < 2 && this.preTrackID != this.trackID){
            this.trackID = this.preTrackID;
            this.yaw = this.preYaw;
            this.pitch = this.prePitch;
            this.tIdCount++;
        }else if(this.tIdCount >= 2){
            this.tIdCount = 1;
        }
    }
    var mediaURLs = this.MP.getMediaRequestsSimple(this.yaw, this.pitch, this.segmentNr);
    if(this.preTrackID != this.trackID && this.preTrackID != 0){
        var switchObj = {
            trackID: this.trackID,
            mediaTime: this.SE.getCurrentTime(),
        };
        this.requestNextSegQ.enqueue(switchObj);
    }
    
    this.preTrackID = this.trackID;
    this.preYaw = this.yaw;
    this.prePitch = this.pitch;
    Log.info("Extractor Track ID : ", this.trackID);
    if (this.ME.setActiveTrackID(this.trackID, this.segmentNr)) {
        this.DL.loadMediaSegments(mediaURLs, (this.segmentNr++));
    }
}

OMAFPlayer.prototype.getMetrics = function(){
    var self = this;
    var metrics = {};
    if(this.RE.initialized){
        var pos = this.RE.getOMAFPosition();
        metrics["yaw"] = THREE.Math.radToDeg(pos.phi);
        metrics["pitch"] = THREE.Math.radToDeg(pos.theta);

        var hz = Math.round(self.RE.getHZ());
        if(self.displayHZ === 0 || self.displayHZ !== hz){
            self.displayHZ = hz;
            self.MT.updateRefreshRate(self.displayHZ);
        }     
        //var posVecCube = self.sphereCoordToCube(posVecSphere);
        self.MT.checkLongestRenderedViewport();
      
        metrics["fovH"] = parseInt(self.MT.getRenderedFovSet().renderedFovH);
        metrics["fovV"] = parseInt(self.MT.getRenderedFovSet().renderedFovV);
        metrics["displayRes"] = self.MT.getDisplayInfoSet().displayResolution;
        metrics["displayHz"] = self.MT.getDisplayInfoSet().displayRefreshRate;
        if (self.MT.getRenderedViewportList()){
            metrics["longestTr"] = self.MT.getRenderedViewportList().viewport.viewpoint_id;
            metrics["longestStart"] = self.milliToTime(self.MT.getRenderedViewportList().startTime);
            metrics["longestDur"] = self.MT.getRenderedViewportList().duration;
        }else{
            metrics["longestTr"] = 0;
            metrics["longestStart"] = 0;
            metrics["longestDur"] = 0;
        }
        if (self.MT.getCQViewportSwitchingLatencyList()){
            metrics["cqFirVP"] = "y:" + parseInt(self.MT.getCQViewportSwitchingLatencyList().firstViewport.centre_azimuth / 65536)
                                 + " p:" + parseInt(self.MT.getCQViewportSwitchingLatencyList().firstViewport.centre_elevation / 65536);
            metrics["cqSecVP"] = "y:" + parseInt(self.MT.getCQViewportSwitchingLatencyList().secondViewport.centre_azimuth / 65536)
                                + " p:" + parseInt(self.MT.getCQViewportSwitchingLatencyList().secondViewport.centre_elevation / 65536);
            metrics["latency"] = self.MT.getCQViewportSwitchingLatencyList().latency;
        }else{
            metrics["cqFirVP"] = 0;
            metrics["cqSecVP"] = 0;
            metrics["latency"] = 0;
        }
       
    } else{
        metrics["yaw"] = this.yaw;
        metrics["pitch"] = this.pitch;
        metrics["fovH"] = 0;
        metrics["fovV"] = 0;
        metrics["displayRes"] = 0;
        metrics["displayHz"] = 0;
        metrics["longestTr"] = 0;
        metrics["longestStart"] = 0;
        metrics["longestDur"] = 0;
        metrics["cqFirVP"] = 0;
        metrics["cqSecVP"] = 0;
        metrics["latency"] = 0;
    }
    metrics["trackID"] = this.trackID;
    metrics["segNr"] = this.segmentNr;

    
    return metrics;
}

OMAFPlayer.prototype.milliToTime = function (millisec) {
    var milliseconds = (millisec % 1000) / 100,
    seconds = Math.floor((millisec / 1000) % 60),
    minutes = Math.floor((millisec / (1000 * 60)) % 60),
    hours = Math.floor((millisec / (1000 * 60 * 60)) % 24);

    hours = (hours < 10) ? "0" + hours : hours;
    minutes = (minutes < 10) ? "0" + minutes : minutes;
    seconds = (seconds < 10) ? "0" + seconds : seconds;

    return hours + ":" + minutes + ":" + seconds + "." + milliseconds;
}

OMAFPlayer.prototype.sphereCoordToCube = function (sphereVec3) {
    var posVecSphereAbs = new THREE.Vector3(Math.abs(sphereVec3.x), Math.abs(sphereVec3.y), Math.abs(sphereVec3.z));
    var isCubeFaceY =  Boolean(posVecSphereAbs.y >= posVecSphereAbs.x && posVecSphereAbs.y >= posVecSphereAbs.z);
    var isCubeFaceX =  Boolean(posVecSphereAbs.x >= posVecSphereAbs.z);
    return this.getCubeCoord(sphereVec3, isCubeFaceY, isCubeFaceX);
}

OMAFPlayer.prototype.getCubeCoord = function (sphere ,isCubeFaceY, isCubeFaceX) {
    var inverseSqrt2 = 0.70710676908493042;
    var sphereX, sphereY , sphereZ;
    
    if(isCubeFaceY){
        sphereX = sphere.x;
        sphereY = sphere.z;
        sphereZ = sphere.y;
    }else{
        if(isCubeFaceX){
            sphereX = sphere.y;
            sphereY = sphere.z;
            sphereZ = sphere.x;
        }else{
            sphereX = sphere.x;
            sphereY = sphere.y;
            sphereZ = sphere.z;
        }
    }
    var xx2 = sphereX * sphereX * 2;
    var yy2 = sphereY * sphereY * 2;

    var v = new THREE.Vector2(xx2 - yy2, yy2 - xx2);

    var ii = v.y - 3;
    ii *= ii;

    var isqrt = -Math.sqrt(ii - 12 * xx2) + 3;
    v.x = Math.sqrt(v.x + isqrt);
    v.y = Math.sqrt(v.y + isqrt);

    v.x *= inverseSqrt2;
    v.y *= inverseSqrt2;
   
    var resultVec3;
    if(isCubeFaceY){
        resultVec3 = new THREE.Vector3(Math.sign(sphereX) * v.x, Math.sign(sphereZ) * 1, Math.sign(sphereY) * v.y);
    }else{
        if(isCubeFaceX){
            resultVec3 = new THREE.Vector3(Math.sign(sphereZ) * 1, Math.sign(sphereX) * v.x, Math.sign(sphereY) * v.y);
        }else{
            resultVec3 = new THREE.Vector3(Math.sign(sphereX) * v.x, Math.sign(sphereY) * v.y,  Math.sign(sphereZ) * 1);
        }
    }
    return resultVec3;
}

OMAFPlayer.prototype.checkSubBuffer = function(vidTime){
    var self = this;
    this.subBufReq  = setInterval(function checkSub(){
        var isChanged = false;
        if(self.ME.isSubBufActive() && self.readySubRender){ 
            self.RE.setIsAniPause(true);
            if(!self.segDifArr.length){
                self.isAddDif =  false;
                self.RE.setSwitch(false);
            }else{
                self.RE.setMaxCurTime(self.segDifArr.shift());
            }
           
            self.subVidElement.play();
            self.renderElement.style.zIndex = "8";
            self.subRenderElement.style.zIndex = "10";
            
            self.renderedPreTrackID = self.renderedTrackID;
            self.renderedTrackID = self.switchInfoQ.front().trackID;
            self.isPushChangeVP = true;
            self.RE.readyToChangeTrack(true);
            self.RE.setIsAniPause(false);
            self.SE.activeVideoElement("SLAVE",(self.switchInfoQ.front().segNum) -1);
            self.ME.removeBuf(false, false);
            self.isOnMainVid = false;
            self.switchInfoQ.dequeue();
            isChanged = true;
            self.readySubRender = false;
        
        }else if(!self.ME.isSubBufActive() && self.isOnLoop && self.isLastBuf){
            while(!self.switchInfoQ.empty()){
                self.switchInfoQ.dequeue();
            }
            while(!self.requestNextSegQ.empty()){
                self.requestNextSegQ.dequeue();
            }
            self.segmentNr = 1;
            self.isFirstsegment = true;
            self.bufferOffsetTime = 0; 
            self.renderedTrackID = 0;
            self.SE.activeVideoElement("MASTER",0);
            self.RE.setIsAniPause(true);
            self.ME.removeBuf(false, true);
            self.ME.reset(true);
            self.isReset = true;
            self.isLastBuf = false;
            self.isOnMainVid = true;
            isChanged = true;
        }
        if(isChanged || (self.vidElement.currentTime != vidTime)) {
            clearInterval(self.subBufReq);
        }else{
            return checkSub;
        }
    }(), 100);
}

OMAFPlayer.prototype.checkMainBuffer = function(vidTime){
    var self = this;
    this.mainBufReq  = setInterval(function checkMain(){
        var isChanged = false;
        if(self.ME.isMainBufActive() &&  self.readyMainRender){
            self.RE.setIsAniPause(true);
            if(!self.segDifArr.length){
                self.isAddDif =  false;
                self.RE.setSwitch(false);
            }else{
                self.RE.setMaxCurTime(self.segDifArr.shift());
            }
          
            self.vidElement.play();
            self.renderElement.style.zIndex = "10";
            self.subRenderElement.style.zIndex = "8";

            self.renderedPreTrackID = self.renderedTrackID;
            self.renderedTrackID = self.switchInfoQ.front().trackID;
            self.isPushChangeVP = true;
            self.RE.readyToChangeTrack(false);
            self.RE.setIsAniPause(false);
            self.SE.activeVideoElement("MASTER",(self.switchInfoQ.front().segNum) -1);
        
            self.ME.removeBuf(true, false);
            self.isOnMainVid = true;
            self.switchInfoQ.dequeue();
            isChanged = true;
            self.readyMainRender = false;
            
        }else if(!self.ME.isMainBufActive() && self.isOnLoop && self.isLastBuf){
            while(!self.switchInfoQ.empty()){
                self.switchInfoQ.dequeue();
            }
            while(!self.requestNextSegQ.empty()){
                self.requestNextSegQ.dequeue();
            }
            self.segmentNr = 1;
            self.isFirstsegment = true;
            self.bufferOffsetTime = 0;
            self.renderedTrackID = 0;
            self.SE.activeVideoElement("MASTER",0);
            self.RE.setIsAniPause(true);
            self.ME.removeBuf(true, true);
            self.ME.reset(true);
    
            self.isReset = true;
            self.isLastBuf = false;
            self.isOnMainVid = true;
            isChanged = true;

        }
        if(isChanged || (self.subVidElement.currentTime != vidTime)) {
            clearInterval(self.mainBufReq);
        }else{
            return checkMain;
        }
    }(), 100);
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
        delete this.MT;
    
        delete this.videoController;
        delete this.mouseMoveHandler;
        delete this.switchInfoQ;
        delete this.segDifArr;
        clearTimeout(this.videoControllerVisibleTimeout);
        clearInterval(self.mainBufReq);
        clearInterval(self.subBufReq);
        clearInterval(self.pauseReq);
        clearInterval(self.metricsReq);
        
        this.segmentNr      = 1;
        this.tIdCount       = 1;
        this.segDifArr      = [];
        this.isAddDif       = false;
        this.userChangeVPList   = [];

        this.bufferOffsetTime = 0;
        this.maxDifSegNum   = 0;
        this.recentChangedSegNum    = 0;
        this.longestMediaTimeMS     = 0;
        this.renderedTrackID = 0;

        this.switchInfoQ = new Queue;
        this.isPlaying = false;
        this.readyInitRender = false; 
        this.initialized = false;
        this.isFirstsegment = true;
        this.readyMainRender = false;
        this.readySubRender = false;
    }
}

OMAFPlayer.prototype.loop = function(element){
    if(this.isOnLoop){
        $(element).removeClass('fa-repeat').addClass('fa-long-arrow-right ');
        this.isOnLoop = false;
    }else{
        $(element).removeClass('fa-long-arrow-right').addClass('fa-repeat ');
        this.isOnLoop = true;
    }
}
