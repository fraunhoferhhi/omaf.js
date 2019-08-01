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

var logLevel = window.logLevel;

function MediaEngine() {
    this.isBusy         = false;
    this.isInit         = false;
    this.isSubInit      = false;
    this.isSubBuffer    = false;
    this.isMainActive   = false;
    this.isSubActive    = false;
    this.isLastBuf      = false;
    this.isReset        = false;
    this.isRemoveBuf    = false;
    
    this.initialized    = false;
    this.MSEinitialized = false;    // this is true if we sucessfully inserted repackaged moov and sourceBuffer is ready to go
    this.subMSEinitialized = false;
    this.initSegments   = {};       // hvc2_trackID (Number): moov (ArrayBuffer), ...
    this.hvc2Infos      = {};       // hvc2_trackID (Number): mp4boxInfo (Object), ...
    this.asIDtoTrackID  = {};       // key = asID, value = trackID

    this.currentTrackID = null;     // hvc2_trackID which is selected for playback
    this.switchTrackID  = null;
    this.downloadedSegNum  = 0;     // segment number which is downloaded
    this.lastSegNum     = 0;
    this.mainBufSegNum  = 0; 
    this.subBufSegNum   = 0;
    this.preSegNum      = 0;
    this.trackRefs      = null;     // track references (list of trackIDs currentTrackID depends on)
    this.currentMp4Box  = null;     // an active instance of mp4box.js
    this.nextFileStart  = 0;
    this.framesPerSegment = null;   // this is set once we download first mediasegment(s)ƒ
    this.nextMoofNumber = 1;        // mfhd->sequence_number
    this.nextDecodeTime = 0;        // traf->tfdt->baseMediaDecodeTime
    this.checkBufReq  = null;
    
    // MSE stuff
    this.videoElement   = null;
    this.subVidElement  = null;
    this.mediaSource    = null;
    this.subMediaSource = null;
    this.sourceBuffer   = null;
    this.subSourceBuffer   = null;
    this.updateBuffer   = [];
    this.subUpdateBuffer   = [];
    this.manageBufferQ  = new Queue();
    this.mimeType       = null;
    this.initSegmentData = null;    // contains a 'fake' moov box (init segment) for MSE
    this.lastMediaSegment = null;   // this is our latest repackaged media segment

    // events
    this.onInit = null;             // this is called when everything is ready for MediaEngine to work
    this.onMediaProcessed = null;   // this is called when media segments are repackaged and processed by MSE
    this.onSwitchTrack  = null;
    this.onFinish  = null;
    this.onReset  = null;

    this.downloadFile = null;
}

MediaEngine.prototype.getHvc2Info = function(trackID){
    var retVal = this.hvc2Infos[trackID];
    if (typeof retVal !== 'undefined'){
        return retVal;
    }
    Log.warn("ME", "Could not find initialization segment for hvc2 track with trackID=" + trackID);
    return null;
}

MediaEngine.prototype.getTrackReferences = function(trackID){
    var retVal = null;
    try{
        retVal = this.getHvc2Info(trackID).references[0].track_ids;
    }catch(er){
        Log.warn("ME", "Could not find track references for trackID=" + trackID);
        return null;
    }
    return retVal;
}

MediaEngine.prototype.setActiveTrackID = function(trackID, segNum){
    if(segNum > this.lastSegNum && this.lastSegNum > 0){
        return false;
    }
    if(this.currentTrackID===trackID){
        return true;
    } 
    if (!(this.initSegments.hasOwnProperty(trackID))) {
        ErrorPopUp("Track(id = " + trackID + ") with 'hvc2' track type could not be found");
        return false;
    }
    if(this.isBusy) {
        Log.warn("ME", "Can not change active trackID since mediaengine is busy! Try again later.");
        return false;
    }

   // this.resetActiveMp4Box(trackID);
    if(this.currentTrackID == null){ // only for first time
        if(this.switchTrackID == null){ // To distinguish from reset
            this.setInitsegmentData(trackID);
            if(!this.sourceBuffer.updating){
                this.sourceBuffer.appendBuffer(this.initSegmentData);
            }else{
                this.updateBuffer.push(this.initSegmentData);
            }
            if(!this.subSourceBuffer.updating){
                this.subSourceBuffer.appendBuffer(this.initSegmentData);
            }else{
                this.subUpdateBuffer.push(this.initSegmentData);
            }
        }
        this.switchTrackID = trackID;
        this.preSegNum  = 1;
    }
    if(segNum == 1){
        this.switchTrackID = trackID;
    }
    this.currentTrackID = trackID;
    this.trackRefs = this.getTrackReferences(trackID);
    return true;
}

MediaEngine.prototype.resetActiveMp4Box = function(trackID){
    Log.info("ME", "Delete previous mp4box object and create a new one");
    this.currentMp4Box = null;
    delete this.currentMp4Box;
    this.nextFileStart = 0;
    this.currentMp4Box = MP4Box.createFile();
    
    // append init segment and store fileStart value for future media segments
    Log.setLogLevel(Log.error); // shut up :D
    this.nextFileStart = this.currentMp4Box.appendBuffer(this.initSegments[trackID]);
    Log.setLogLevel(logLevel); // you can talk again. todo: remove it later. this is just for debugging
}

MediaEngine.prototype.setInitsegmentData = function(trackID){
    var tempMp4Box = MP4Box.createFile(); // we will mess it up
    Log.setLogLevel(logLevel); // shut up :D
    tempMp4Box.appendBuffer(this.initSegments[trackID]);
    Log.setLogLevel(logLevel); // you can talk again. todo: remove it later. this is just for debugging
    
    this.initSegmentData = tempMp4Box.getRepackagedMoov();
}

MediaEngine.prototype.getInitSegment = function() {
    return this.initSegmentData;
}

MediaEngine.prototype.getLastMediaSegment = function() {
    return this.lastMediaSegment;
}

// this creates arrayOfMoovs.length number of mp4box objects parses them and destroys them
MediaEngine.prototype.init = function (vidElement, subVidElement, mimeType, lastSegNum, dataAndASIDs) {
    if (this.initialized){
        Log.warn("ME", "MediaEngine was already initialized.");
        return;
    }
    Log.info("ME", "start MediaEngine initialization");

    var arrayOfMoovs = dataAndASIDs.data;
    var asIDs = dataAndASIDs.asIDs;
    var self = this;

    this.videoElement = vidElement;
    this.subVidElement = subVidElement
    this.mimeType = mimeType;
    this.lastSegNum = lastSegNum;
    if (window.MediaSource) {
        this.mediaSource = new MediaSource();
        this.subMediaSource = new MediaSource();
    } else {
        ErrorPopUp("This device does not support Media Source Extensions API");
        return;
    }

    this.mediaSource.addEventListener('sourceopen', function (e) {
        Log.info("ME", "MediaSource is now in opened state. Finish MediaEngine initialization with mime type = " + self.mimeType);
        self.initMSE();
    });

    this.subMediaSource.addEventListener('sourceopen', function (e) {
        self.initSubMSE();
    });

    // create all mp4box objects and add moov's to each
    var tempMp4BoxHolder = [];
    Log.setLogLevel(Log.error); // shut up :D
    for(var i=0; i<arrayOfMoovs.length ; i++){  
        var asID = asIDs[i];
        var mp4box = MP4Box.createFile();
        arrayOfMoovs[i].fileStart = 0;
        mp4box.appendBuffer(arrayOfMoovs[i]);
        mp4box.flush();
        tempMp4BoxHolder.push({"asID": asID, "mp4box": mp4box});
    }
    Log.setLogLevel(logLevel); // you can talk again. todo: remove it later. this is just for debugging

    // iterate over parsed moov metadata and search for hvc2 tracks
    for(var i=0; i<arrayOfMoovs.length; i++){
        var asID = tempMp4BoxHolder[i].asID;
        var info = tempMp4BoxHolder[i].mp4box.getInfo();
        for (var j = 0; j < info.videoTracks.length; j++){       
            rinf = tempMp4BoxHolder[i].mp4box.moov.traks[j].mdia.minf.stbl.stsd.entries[0].rinf;      
            var trackType = rinf.frma.data_format;
            if(trackType==="hvc2"){
                var stream          = new Uint8Array(rinf.schi.povd.data);    
                prfr                = parsePRFRBox(new DataStream(stream));
                stream              = stream.slice(prfr.size, stream.size ); 
                var rwpk            = parseRWPKBox( new DataStream (stream) );
                info.videoTracks[j].rwpk                    = rwpk ;
                info.videoTracks[j].prfr                    = prfr;    
                this.hvc2Infos[info.videoTracks[j].id]      = info.videoTracks[j];
                this.initSegments[info.videoTracks[j].id]   = arrayOfMoovs[i];
                this.asIDtoTrackID[asID]                    = info.videoTracks[j].id;
                break;
            }
        }
    }

    if (this.onMediaProcessed == null) {
        Log.error("ME", "onMediaProcessed callback not set");
        return;
    }

    this.checkBufQ();

    // after this sourceopen event will be executed after some delay
    // make sure that mediaSource.addEventListener('sourceopen', ... is set in the main.js file
    this.subVidElement.src = URL.createObjectURL(this.subMediaSource);
    this.videoElement.src = URL.createObjectURL(this.mediaSource);
}

MediaEngine.prototype.getTrackIDFromASID = function(asID){
    return this.asIDtoTrackID[asID];
}

MediaEngine.prototype.initMSE = function(){
    URL.revokeObjectURL(this.videoElement.src);
    try{
        this.sourceBuffer = null;
        delete this.sourceBuffer;
        this.sourceBuffer = this.mediaSource.addSourceBuffer(this.mimeType);
        if (typeof this.sourceBuffer.addEventListener === 'function') {
            Log.info("ME", "set up sourcebuffer event listeners");
            this.sourceBuffer.addEventListener('error', function(e){
                ErrorPopUp("The soureBuffer of MSE has the following error <br> Error: " + e );
            }, false);
            this.sourceBuffer.addEventListener('abort', function (e) {
                ErrorPopUp("The soureBuffer of MSE is aborted <br> Error: " + e );
            }, false);

            var self = this;
            
            this.sourceBuffer.addEventListener('updateend', function (e) {
                Log.debug("ME", "sourceBuffer append or remove has ended");

                if (!self.MSEinitialized){
                    Log.warn("ME", "sourceBuffer first updateend call. Init segment inserted");
                    self.MSEinitialized = true;
                    
                }else if(self.isReset){
                    self.onReset();
                    self.isRemoveBuf = false;
                    self.isReset = false;
                }else{
                    if(self.isLastBuf && !self.updateBuffer.length){
                        self.onFinish();
                    }else{
                        if(!self.isRemoveBuf){
                            //self.onMediaProcessed();
                        }else{
                            self.isMainActive = false;
                            self.isRemoveBuf = false;
                        }
                    }
                }
                if ( self.updateBuffer.length ) {
                    self.sourceBuffer.appendBuffer(self.updateBuffer.shift());
                }
            }, false);
        }
        
    } catch(ex){
        ErrorPopUp("This browser does not support the following mimetype <br> mimiType: " + this.mimeType + " <br> Please use another browser.");
        this.initialized = false;
        throw ex;
    }
    if(!this.isInit){
        this.isInit = true;
        
        if (this.onInit == null) {
            Log.warn("ME", "OnInit callback not set");
        }
        else if(this.isInit && this.isSubInit && !this.initialized){
            this.initialized = true;
            this.onInit();
        }   
    }
}

MediaEngine.prototype.initSubMSE = function(){
    URL.revokeObjectURL(this.subVidElement.src);
    try{
        this.subSourceBuffer = this.subMediaSource.addSourceBuffer(this.mimeType);
        if (typeof this.subSourceBuffer.addEventListener === 'function') {
            Log.info("ME", "set up subSourceBuffer event listeners");
            this.subSourceBuffer.addEventListener('error', function(e){
                ErrorPopUp("The soureBuffer of MSE has the following error <br> Error: " + e );  
            }, false);
            this.subSourceBuffer.addEventListener('abort', function (e) {
                ErrorPopUp("The soureBuffer of MSE is aborted <br> Error: " + e );
            }, false);

            var self = this;
            this.subSourceBuffer.addEventListener('updateend', function (e) {
                Log.debug("ME", "subSourceBuffer append or remove has ended");
             
                if (!self.subMSEinitialized){
                    Log.warn("ME", "sub sourceBuffer first updateend call. Init segment inserted");
                    self.subMSEinitialized = true;
                    
                }else{
                    if(self.isLastBuf && !self.updateBuffer.length){
                        self.onFinish();
                        self.isRemoveBuf = false;
                    }else if(self.isReset){
                        self.onReset();
                        self.isRemoveBuf = false;
                        self.isReset = false;
                    }else{
                        if(self.downloadedSegNum > 1){
                            if(!self.isRemoveBuf){
                                //self.onMediaProcessed();
                            }else{
                                if(self.subBufSegNum > 0){
                                    self.isSubActive = false;
                                }
                                self.isRemoveBuf = false;
                            }
                        }else{
                            self.isRemoveBuf = false;
                        }
                    }
                }
                
                if ( self.subUpdateBuffer.length ) {
                    self.subSourceBuffer.appendBuffer(self.subUpdateBuffer.shift());
                }
               
            }, false);
        }
        
    } catch(ex){
        ErrorPopUp("This browser does not support the following mimetype <br> mimiType: " + this.mimeType + " <br> Please use another browser.");
        this.initialized = false;
        throw ex;
    }
    if(!this.isSubInit){
        this.isSubInit = true;
        if (this.onInit == null) {
            Log.warn("ME", "OnInit callback not set");
        }
        else if(this.isInit && this.isSubInit && !this.initialized){
            this.initialized = true;
            this.onInit();
        }
    }
}
  
MediaEngine.prototype.getRWPKs = function(){
    var retVal = {};
    for(var key in this.hvc2Infos){
        retVal[key] = this.hvc2Infos[key].rwpk;
    }
    return retVal;
}

MediaEngine.prototype.getSRQRs = function(){
    var retVal = {};
    for(var key in this.hvc2Infos){
        retVal[key] = this.hvc2Infos[key].srqr;
    }
    return retVal;
}

MediaEngine.prototype.processMedia = function (arrayOfMoofMdats, segNum){
    //this.currentSegNum = segNum;
    var self = this;
    this.isBusy = true;
    this.downloadedSegNum++;
   // Log.warn("ME","processMedia segnum : " + segNum +  " the track ID is : "+ this.currentTrackID);


    if(this.downloadedSegNum == this.lastSegNum && this.lastSegNum > 0){
        this.isLastBuf = true;
    }

    Log.info("ME", "Start repackaging of media data for trackID = " + this.currentTrackID);
   
    if(this.currentTrackID != this.switchTrackID){
        
        var difSegNum =  this.downloadedSegNum - this.preSegNum ;
        var preTrackID = this.switchTrackID;
        //Log.warn("ME","processMedia segnum : " + difSegNum +  " the track ID is : "+ this.currentTrackID);
        this.preSegNum = this.downloadedSegNum;
        this.isSubBuffer = !this.isSubBuffer;
        this.nextDecodeTime = 0;
        this.switchTrackID = this.currentTrackID;
        this.onSwitchTrack(this.currentTrackID, this.downloadedSegNum, difSegNum, preTrackID);
    }

    this.resetActiveMp4Box(this.currentTrackID);
    
    // append moof+mdats for all tracks
    for (var i = 0; i < arrayOfMoofMdats.length; i++) {
        arrayOfMoofMdats[i].fileStart = this.nextFileStart;
        Log.setLogLevel(Log.error); // shut up :D
        this.nextFileStart = this.currentMp4Box.appendBuffer(arrayOfMoofMdats[i]);
        Log.setLogLevel(logLevel); // you can talk again. todo: remove it later. this is just for debugging
    }
    
    // first time set frames per segment
    if (null == this.framesPerSegment){
        var samplesInfo = this.currentMp4Box.getTrackSamplesInfo(this.currentTrackID);
        this.framesPerSegment = samplesInfo.length;
        Log.info("ME", "frames per segment = " + this.framesPerSegment);
    }
    
    // parse samples and resolve extractors
    Log.setLogLevel(Log.warn); // shut up :D
    var bitstream = this.getResolvedBitstream();
    Log.setLogLevel(logLevel); // you can talk again. todo: remove it later. this is just for debugging

    // package resolved bitstream
    this.lastMediaSegment = this.packageBitstream(bitstream);

    this.isBusy = false;

    var bufObj = {
        mediaData: self.lastMediaSegment,
        isSubBuf: self.isSubBuffer,
        segNum: self.downloadedSegNum,
        trackID: self.currentTrackID,
    };
    this.manageBufferQ.enqueue(bufObj);

   
    this.onMediaProcessed();
    
}

MediaEngine.prototype.packageBitstream = function(bitstream){
    var stream = new DataStream();
    stream.endianness = DataStream.BIG_ENDIAN;
 
    var moof = new BoxParser.moofBox();
    moof.add("mfhd").set("sequence_number", this.nextMoofNumber++);
    var traf = moof.add("traf");
    traf.add("tfhd").set("track_id", 1)
        .set("flags", BoxParser.TFHD_FLAG_DEFAULT_BASE_IS_MOOF);
    traf.add("tfdt").set("baseMediaDecodeTime", this.nextDecodeTime);
    this.nextDecodeTime += bitstream.meta.sample_durations_sum;

    var trun = traf.add("trun");
    trun.set("flags", BoxParser.TRUN_FLAGS_DATA_OFFSET
        | BoxParser.TRUN_FLAGS_SIZE 
        | BoxParser.TRUN_FLAGS_CTS_OFFSET 
        | BoxParser.TRUN_FLAGS_FLAGS
        | BoxParser.TRUN_FLAGS_DURATION)
        .set("data_offset", 236) // moof.size + 8: this is fixed
        .set("sample_count", this.framesPerSegment)
        .set("sample_size", bitstream["lengths"])
        .set("sample_composition_time_offset", bitstream.meta.cts_offsets)
        .set("sample_flags", bitstream.meta.sample_flags)
        .set("sample_duration", bitstream.meta.sample_durations);
    trun.set("version", 1); // we use version 1 which allows to have negative values in cts_offsets
    moof.write(stream);
    var mdat = new BoxParser.mdatBox();
    var uint8Bitstream = new Uint8Array(bitstream["buffer"]); // related to issue #5
    mdat.data = uint8Bitstream;
    mdat.write(stream);

    return stream.buffer;
}

MediaEngine.prototype.getResolvedBitstream = function () {
    // todo: improve performance by removing all ArrayBuffer.concat's we can allocate a big buffer (using filesizes of data we downloaded)
    //      and modify the buffer using DataView (low level API) or use DataStream as in mp4box.js
    var vRet = {"lengths": []};
    var buffer = new ArrayBuffer();
    var samplesInfo = this.currentMp4Box.getTrackSamplesInfo(this.currentTrackID);
    var meta = this.getPackagingMetadata(samplesInfo);
    
    for (var n = 0; n < this.framesPerSegment; n++) {
        var sampleBuffer = this.getResolvedSample(n);
        buffer = ArrayBuffer.concat(buffer, sampleBuffer);
        vRet["lengths"].push(sampleBuffer.byteLength);
    }
    vRet["meta"] = meta;
    vRet["buffer"] = buffer;
    return vRet;
}

MediaEngine.prototype.getPackagingMetadata = function(sampleInfos) {
    // this function parses sampleInofs and returns metadata which is required for mp4 packaging, such as,
    // sample flags, durations, cts offsets, etc...

    var meta = {"sample_durations": [], 
                "sample_flags": [],
                "cts_offsets": [],
                "sample_durations_sum": 0}

    for (var n = 0; n < sampleInfos.length; n++) {
        // warning, it is asumed that bit(3) sample_padding_value = 0
        var flag = (sampleInfos[n].is_leading & 0x3) << 26 | 
        (sampleInfos[n].depends_on & 0x3) << 24 | 
        (sampleInfos[n].is_depended_on & 0x3) << 22 |
        (sampleInfos[n].has_redundancy & 0x3) << 20 |
        (!sampleInfos[n].is_sync) << 16 |
        (sampleInfos[n].degradation_priority & 0xffff);

        meta["sample_durations"].push(sampleInfos[n].duration);
        meta["sample_flags"].push(flag);
        meta["cts_offsets"].push(sampleInfos[n].cts - sampleInfos[n].dts);
        meta["sample_durations_sum"] += sampleInfos[n].duration;
    }
    return meta;
}

MediaEngine.prototype.getResolvedSample = function(n){
    var vRet = new ArrayBuffer();

    var sample = this.currentMp4Box.getTrackSample(this.currentTrackID, n);

    var NalStart = 0;
    while (NalStart < sample.data.byteLength){
        var currentNalPtr = NalStart + 4; // current nalu position 
        var nalSize = ((sample.data[NalStart] & 0xff) << 24) | 
            ((sample.data[NalStart + 1] & 0xff) << 16) |
            ((sample.data[NalStart + 2] & 0xff) << 8) |
            (sample.data[NalStart + 3] & 0xff);

        NalStart += 4 + nalSize; // next nalu start position 
        
        var NaluType = (sample.data[currentNalPtr] & 0x7e) >> 1;
        if (49 === NaluType){
            // extractor NALU found / now iterate over all constructors
            var uiConstrStart = 2;
            var bNALULengthRewrite = false;
            var iNALULengthIdx = -1;
            var uiNALULengthCorrect = 0; 

            do {
                var uiConstrType = sample.data[currentNalPtr + uiConstrStart++];
                if (0 == uiConstrType){ // sample constructor
                    if (0 > iNALULengthIdx) { iNALULengthIdx = vRet.byteLength; }
                    var uiDataOffset = 0;
                    var uiDataLength = 0;
                    var uiTrackRefIdx = sample.data[currentNalPtr + uiConstrStart++];
                    var iSampleOffset = sample.data[currentNalPtr + uiConstrStart++];

                    var uiLengthSizeMinusOne = sample.description.hvcC.lengthSizeMinusOne; 

                    switch (uiLengthSizeMinusOne) {
                        case 0:
                            uiDataOffset = sample.data[currentNalPtr + uiConstrStart++];
                            uiDataLength = sample.data[currentNalPtr + uiConstrStart++];
                            break;
                        case 1:
                            uiDataOffset = ((sample.data[currentNalPtr + uiConstrStart] & 0xff) << 8) |
                                (sample.data[currentNalPtr + uiConstrStart + 1] & 0xff);
                            uiConstrStart += 2;
                            uiDataLength = ((sample.data[currentNalPtr + uiConstrStart] & 0xff) << 8) |
                                (sample.data[currentNalPtr + uiConstrStart + 1] & 0xff);
                            uiConstrStart += 2;
                            break;
                        case 3:
                            uiDataOffset = ((((sample.data[currentNalPtr + uiConstrStart] & 0xff)) << 24) |
                                (((sample.data[currentNalPtr + uiConstrStart + 1] & 0xff)) << 16) |
                                (((sample.data[currentNalPtr + uiConstrStart + 2] & 0xff)) << 8) |
                                ((sample.data[currentNalPtr + uiConstrStart + 3] & 0xff)));
                            uiConstrStart += 4;

                            uiDataLength = (sample.data[currentNalPtr + uiConstrStart] & 0xff) * 16777216 + 
                                (sample.data[currentNalPtr + uiConstrStart + 1] & 0xff) * 65536 + 
                                (sample.data[currentNalPtr + uiConstrStart + 2] & 0xff) * 256 + 
                                (sample.data[currentNalPtr + uiConstrStart + 3] & 0xff);
                            uiConstrStart += 4;
                            break;
                        default:
                            throw "LengthSizeMinusOne not supported";
                    }

                    var RefTrack_id = this.trackRefs[uiTrackRefIdx - 1];

                    var refSample = this.currentMp4Box.getTrackSample(RefTrack_id, n+iSampleOffset);
                    if (0 == uiDataLength) {
                        uiDataLength = refSample.data.byteLength;
                    }
                    if (uiDataOffset + uiDataLength > refSample.data.byteLength){
                        // When data_offset + data_length is greater than the size of the sample, the bytes from the byte
                        // pointed to by data_offset until the end of the sample, inclusive, are copied
                        uiDataLength = refSample.data.byteLength - uiDataOffset;
                        bNALULengthRewrite = true;
                        // Log.warn("MEdebug", "we need to rewrite nalu length with = " + uiDataLength);
                    }
                    
                    vRet = ArrayBuffer.concat(vRet, refSample.data.slice(uiDataOffset, (uiDataOffset + uiDataLength)));
                    uiNALULengthCorrect += uiDataLength;
                }
                else if (2 == uiConstrType) { // inline constructor
                    if (iNALULengthIdx < 0) { iNALULengthIdx = vRet.byteLength; }
                    var uiLengthInline = sample.data[currentNalPtr + uiConstrStart++];

                    vRet = ArrayBuffer.concat(vRet, sample.data.buffer.slice(currentNalPtr + uiConstrStart, currentNalPtr + uiConstrStart + uiLengthInline));

                    uiNALULengthCorrect += uiLengthInline;
                    uiConstrStart += uiLengthInline;
                }
                else {
                    Log.error("ME", "Unknown constructor type " + uiConstrType + " found at " + currentNalPtr + uiConstrStart);
                    uiConstrStart = nalSize;
                    continue;
                }
            } while (uiConstrStart < nalSize);

            if (iNALULengthIdx + 4 > vRet.length) { // check the length of the buffer
                Log.error("ME", "Can not access Buffer at position = " + iNALULengthIdx + ". Buffer.length is too small.");
                continue;
            }

            if (bNALULengthRewrite) { // rewrite (set) NALU length with correct value
                uiNALULengthCorrect -= 4;
                var tempView = new DataView(vRet);
                tempView.setUint32(iNALULengthIdx, uiNALULengthCorrect);
            }

            var lengthView = new Uint8Array(vRet.slice(iNALULengthIdx, iNALULengthIdx+4));
            var uiNaluLengthParsed = (lengthView[0] & 0xff) * 16777216 +
                (lengthView[1] & 0xff) * 65536 +
                (lengthView[2] & 0xff) * 256 +
                (lengthView[3] & 0xff);

            if (uiNALULengthCorrect < uiNaluLengthParsed) {
                // Resolution of an extractor may result in a reconstructed payload for which there are fewer
                // bytes than what is indicated in the NALUnitLength of the first NAL in that reconstructed payload.
                // In such cases, readers shall assume that only a single NAL unit was reconstructed by the
                // extractors, and shall rewrite the NALUnitLength of that NAL to the appropriate value
                uiNALULengthCorrect -= 4;
                var tempView = new DataView(vRet);
                tempView.setUint32(iNALULengthIdx, uiNALULengthCorrect);
            }
        }
        else {
            Log.warn("ME", "NALU is not of type 49 (HEVC extractors). Discard it for now.")
            continue;
        }
    } // iterate over all NALUs end
    return vRet;
}

MediaEngine.prototype.checkBufQ = function(){
    var self = this;
    this.checkBufReq = setInterval(function () {
        if(!self.manageBufferQ.empty()){
           
            var isSubBuf = self.manageBufferQ.front().isSubBuf;
            var mediaData = self.manageBufferQ.front().mediaData;
            var segNum = self.manageBufferQ.front().segNum;

            var trackID = self.manageBufferQ.front().trackID;
            //Log.warn("checkBufQ", segNum);
            if(!isSubBuf ){
                Log.warn("checkBufQ main", segNum);
                if(segNum == 1 && !self.isReset){
                    self.subVidElement.pause();
                    if(!self.subSourceBuffer.updating){
                        self.subSourceBuffer.appendBuffer(mediaData);
                    }else{
                        self.subUpdateBuffer.push(mediaData);
                    }
                }
                if(!self.isMainActive){
                    if(!self.sourceBuffer.updating && !self.updateBuffer.length){
                        self.sourceBuffer.appendBuffer(mediaData);
                    }else{
                        self.updateBuffer.push(mediaData);
                    }
                    self.isMainActive = true;
                    self.mainBufSegNum = segNum;
                    self.onSwitchGeometry(trackID, false);
                    self.manageBufferQ.dequeue();
                }else{
                    if (self.mainBufSegNum + 1 == segNum){
                        if(!self.sourceBuffer.updating && !self.updateBuffer.length){
                            self.sourceBuffer.appendBuffer(mediaData);
                        }else{
                            self.updateBuffer.push(mediaData);
                        }
                        self.mainBufSegNum = segNum;
                        self.manageBufferQ.dequeue();
                    }
                }
            }else{
                //Log.warn("checkBufQ sub", segNum);
               if(!self.isSubActive){
                    if(!self.subSourceBuffer.updating && !self.subUpdateBuffer.length){
                        self.subSourceBuffer.appendBuffer(mediaData);
                    }else{
                        self.subUpdateBuffer.push(mediaData);
                    }
                    self.isSubActive = true;
                    self.subBufSegNum = segNum;
                    self.onSwitchGeometry(trackID, true);
                    self.manageBufferQ.dequeue();
                }else{
                    if (self.subBufSegNum + 1 == segNum){
                        if(!self.subSourceBuffer.updating &&  !self.subUpdateBuffer.length){
                            self.subSourceBuffer.appendBuffer(mediaData);
                        }else{
                            self.subUpdateBuffer.push(mediaData);
                        }
                        self.subBufSegNum = segNum;
                        self.manageBufferQ.dequeue();

                    }
                }
            }   
        }       
     }, 200) // todo: get rid of this magic value
}

MediaEngine.prototype.removeBuf = function(isSub, isReset){
    this.isReset = isReset;
    if(!isSub){
        this.isMainActive = false;
        if(this.videoElement.buffered.length){
            this.isRemoveBuf = true;
            this.sourceBuffer.remove(0,this.videoElement.buffered.end(0));
            this.videoElement.pause();
        }
        this.videoElement.currentTime = 0;
    }else{
        this.isSubActive = false;
        if(this.subSourceBuffer.buffered.length){
            this.isRemoveBuf = true;
            this.subSourceBuffer.remove(0,this.subVidElement.buffered.end(0));
            this.subVidElement.pause();
        }
        this.subVidElement.currentTime = 0;
    }
}

MediaEngine.prototype.isSubBufActive = function(){
    return this.isSubActive;
}

MediaEngine.prototype.isMainBufActive = function(){
    return this.isMainActive;
}


MediaEngine.prototype.reset = function(isLoop){
    if(isLoop){
        this.currentTrackID = 0;
        this.isSubBuffer    = false;
        this.isLastBuf      = false;
        this.downloadedSegNum  = 0;     
        this.mainBufSegNum  = 0; 
        this.subBufSegNum   = 0;
        this.nextDecodeTime = 0; 
        this.preSegNum  = 1;
        this.isMainActive   = true;

    
        delete this.updateBuffer;
        delete this.subUpdateBuffer;
        this.updateBuffer       = [];
        this.subUpdateBuffer    = [];
    }else{
        window.clearInterval(this.checkBufReq);

        delete this.isBusy;
        delete this.isInit;
        delete this.isSubInit;
        delete this.isSubBuffer;
        delete this.isMainActive;
        delete this.isSubActive;
        delete this.initialized;
        delete this.isLastBuf;
        delete this.isReset;
        delete this.MSEinitialized;  
        delete this.subMSEinitialized;
        delete this.initSegments;   
        delete this.hvc2Infos;    

        delete this.currentTrackID;     
        delete this.switchTrackID;
        delete this.downloadedSegNum;  
        delete this.mainBufSegNum; 
        delete this.subBufSegNum; 
        delete this.trackRefs;   
        delete this.currentMp4Box; 
        delete this.nextFileStart;
        delete this.framesPerSegment; 
        delete this.nextMoofNumber;   
        delete this.nextDecodeTime;
        delete this.checkBufReq;     
    
        // MSE stuff
        delete this.videoElement;
        delete this.subVidElement;
        delete this.mediaSource;
        delete this.subMediaSource;
        delete this.sourceBuffer;
        delete this.subSourceBuffer;
        delete this.updateBuffer;
        delete this.subUpdateBuffer;
        delete this.mimeType;
        delete this.initSegmentData;

        // events
        delete this.onInit;            
        delete this.onMediaProcessed;
        delete this.onSwitchTrack;
    }
}

// ******************************************  this extends mp4box.js *************************************************
BoxParser.CONTAINER_BOXES.push(["povd"]);

BoxParser.createSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_VISUAL, "resv");

BoxParser.resvSampleEntry.prototype.getCodec = function () {
	var i;
	var baseCodec = BoxParser.SampleEntry.prototype.getCodec.call(this)
	if (this.hvcC) {
		baseCodec += '.';
		switch (this.hvcC.general_profile_space) {
			case 0:
				baseCodec += '';
				break;
			case 1:
				baseCodec += 'A';
				break;
			case 2:
				baseCodec += 'B';
				break;
			case 3:
				baseCodec += 'C';
				break;
		}
		baseCodec += this.hvcC.general_profile_idc;
		baseCodec += '.';
		var val = this.hvcC.general_profile_compatibility;
		var reversed = 0;
		for (i = 0; i < 32; i++) {
			reversed |= val & 1;
			if (i == 31) break;
			reversed <<= 1;
			val >>= 1;
		}
		baseCodec += BoxParser.decimalToHex(reversed, 0);
		baseCodec += '.';
		if (this.hvcC.general_tier_flag === 0) {
			baseCodec += 'L';
		} else {
			baseCodec += 'H';
		}
		baseCodec += this.hvcC.general_level_idc;
		var hasByte = false;
		var constraint_string = "";
		for (i = 5; i >= 0; i--) {
			if (this.hvcC.general_constraint_indicator[i] || hasByte) {
				constraint_string = "." + BoxParser.decimalToHex(this.hvcC.general_constraint_indicator[i], 0) + constraint_string;
				hasByte = true;
			}
		}
		baseCodec += constraint_string;
	}
    return baseCodec;
}
function parsePRFRBox(stream) {
    var prfr  = {};

    stream.endianness = false; 
    prfr.size   = stream.readUint32();
    prfr.box_type  = String.fromCharCode(stream.readUint8()) + 
                 String.fromCharCode(stream.readUint8()) + 
                 String.fromCharCode(stream.readUint8()) + 
                 String.fromCharCode(stream.readUint8()) ; 
    offset      = stream.readUint32();
    var temp_8  = stream.readUint8();
    prfr.projectionType = temp_8 & 0x1F;
    return prfr;
}


function parseRWPKBox(stream) {
    var rwpk = {};
    stream.endianness = false;
    rwpk.size = stream.readUint32();
    rwpk.box_type  = String.fromCharCode(stream.readUint8()) + 
                 String.fromCharCode(stream.readUint8()) + 
                 String.fromCharCode(stream.readUint8()) + 
                 String.fromCharCode(stream.readUint8()) ; 
    offset    = stream.readUint32();
    var tmp_8 = stream.readUint8();
    rwpk.constituent_picture_matching_flag = (tmp_8 >> 7) & 0x1;
    rwpk.num_regions            = stream.readUint8();
    rwpk.proj_picture_width     = stream.readUint32();
    rwpk.proj_picture_height    = stream.readUint32();
    rwpk.packed_picture_width   = stream.readUint16();
    rwpk.packed_picture_height  = stream.readUint16();
	rwpk.regions = [];
	for (var i = 0; i < rwpk.num_regions ; i++) {
		tmp_8 = stream.readUint8();
		var reg = {};
		reg.guard_band_flag = (tmp_8 >> 4) & 0x1;
		reg.packing_type = tmp_8 & 0xF;
		if (reg.packing_type !== 0){
			Log.error("OMAF v1 only supoorts packing_type=0");
			return;
		}
		reg.proj_reg_width = stream.readUint32();
		reg.proj_reg_height = stream.readUint32();
		reg.proj_reg_top = stream.readUint32();
		reg.proj_reg_left = stream.readUint32();

		tmp_8 = stream.readUint8();
		reg.transform_type = (tmp_8 >> 5) & 0x7;

		reg.packed_reg_width = stream.readUint16();
		reg.packed_reg_height = stream.readUint16();
		reg.packed_reg_top = stream.readUint16();
		reg.packed_reg_left = stream.readUint16();

		if (reg.guard_band_flag == 1){
			reg.left_gb_width = stream.readUint8();
			reg.right_gb_width = stream.readUint8();
			reg.top_gb_height = stream.readUint8();
			reg.bottom_gb_height = stream.readUint8();

			var tmp_16 = stream.readUint16();
			reg.gb_not_used_for_pred_flag = (tmp_16 >> 15) & 0x1;
			var gb_type_entry = [0, 0, 0, 0];
			gb_type_entry[0] = (tmp_16 >> 12) & 0x7;
			gb_type_entry[1] = (tmp_16 >> 9) & 0x7;
			gb_type_entry[2] = (tmp_16 >> 6) & 0x7;
			gb_type_entry[3] = (tmp_16 >> 3) & 0x7;
			reg.gb_type = gb_type_entry;
		}
        rwpk.regions.push(reg);
    }
    return rwpk ;
}

function parseSRQRBox(stream) {
    srqr = {};
    stream.endianness = false;
    srqr.size = stream.readUint32();
    srqr.box_type  = String.fromCharCode(stream.readUint8()) + 
                 String.fromCharCode(stream.readUint8()) + 
                 String.fromCharCode(stream.readUint8()) + 
                 String.fromCharCode(stream.readUint8()) ; 
    offset    = stream.readUint32();
    srqr.region_definition_type = stream.readUint8();
	srqr.num_regions = stream.readUint8();

	var tmp_8 = stream.readUint8();
	srqr.remaining_area_flag = (tmp_8 >> 7) & 0x1;
	srqr.view_idc_presence_flag = (tmp_8 >> 6) & 0x1;
	srqr.quality_ranking_local_flag = (tmp_8 >> 5) & 0x1;
	srqr.quality_type = (tmp_8 >> 1) & 0xF;

	if(srqr.view_idc_presence_flag === 0){
		tmp_8 = stream.readUint8();
		srqr.default_view_idc = (tmp_8 >> 6) & 0x3;
	}

	srqr.regions = [];
	for(var i = 0; i < srqr.num_regions; i++){
		var reg = {};
		reg.quality_ranking = stream.readUint8();
		if(srqr.view_idc_presence_flag == 1){
			tmp_8 = stream.readUint8();
			reg.view_idc = (tmp_8 >> 6) & 0x3;
		}
		if(srqr.quality_type == 1){
			reg.orig_width = stream.readUint16();
			reg.orig_height = stream.readUint16();
		}
		if(i < (srqr.num_regions - 1) || srqr.remaining_area_flag === 0){
			var sphereRegion = {};
			sphereRegion.centre_azimuth = stream.readUint32();
			sphereRegion.centre_elevation = stream.readUint32();
			sphereRegion.centre_tilt = stream.readUint32();

			sphereRegion.azimuth_range = stream.readUint32();
			sphereRegion.elevation_range = stream.readUint32();

			tmp_8 = stream.readUint8();
			sphereRegion.interpolate = (tmp_8 >> 7) & 0x1;
			reg.sphereRegion = sphereRegion;
		}
		srqr.regions.push(reg);
    }
    return srqr; 
}

ISOFile.prototype.getRepackagedMoov = function(){
    Log.info("MP4BoxExtension", "Generate moov for hvc2 repackaged content");
    var moov = new BoxParser.moovBox();
    moov.mvhd = this.moov.mvhd;
    moov.mvhd.next_track_id = 2; // trackID will be always 1. so the nextTrackID = 2
    moov.boxes.push(moov.mvhd);
    
    var trak = null;
    // get first 'hvc2' track
    for (var j = 0; j < this.moov.traks.length; j++) {
        var trackType = this.moov.traks[j].mdia.minf.stbl.stsd.entries[0].rinf.frma.data_format;
        if (trackType === "hvc2"){
            trak = this.moov.traks[j];
            break;
        }
    }
    if(null == trak){
        ErrorPopUp("Could not find hvc2 track to create repackaged moov");
        return null;
    }

    // set brands
    var ftyp = this.ftyp;
    ftyp.major_brand = "iso5";
    ftyp.minor_version = 1;
    ftyp.compatible_brands = ["iso4", "hvc1", "iso5", "dash"];

    trak.tkhd.track_id = 1;
    // remove tref
    trak.tref = null;
    delete trak.tref;
    for (var i = 0; i < trak.boxes.length; i++) {
        if (trak.boxes[i].type === "tref"){
            trak.boxes.splice(i, 1);
            break;
        }
    }

    trak.mdia.minf.stbl.stsd.entries[0].type = 'hvc1'; // revrite resv to hvc1

    // remove rinf and srqr boxes. repackaged content does not need them anymore
    trak.mdia.minf.stbl.stsd.entries[0].rinf = null;
    delete trak.mdia.minf.stbl.stsd.entries[0].rinf;
    trak.mdia.minf.stbl.stsd.entries[0].srqr = null;
    delete trak.mdia.minf.stbl.stsd.entries[0].srqr;
    for (var i = 0; i < trak.mdia.minf.stbl.stsd.entries[0].boxes.length; i++) {
        if (trak.mdia.minf.stbl.stsd.entries[0].boxes[i].type === "rinf") {
            trak.mdia.minf.stbl.stsd.entries[0].boxes.splice(i, 1);
            break;
        }
    }
    for (var i = 0; i < trak.mdia.minf.stbl.stsd.entries[0].boxes.length; i++) {
        if (trak.mdia.minf.stbl.stsd.entries[0].boxes[i].type === "srqr") {
            trak.mdia.minf.stbl.stsd.entries[0].boxes.splice(i, 1);
            break;
        }
    }

    // leave only VPS SPS and PPS in hvcC
    for (var i = 0; i < trak.mdia.minf.stbl.stsd.entries[0].boxes.length; i++) {
        if (trak.mdia.minf.stbl.stsd.entries[0].boxes[i].type === "hvcC") {
            // hvcC box found
            var hvcC = this.createHEVCConfigRecord(trak.mdia.minf.stbl.stsd.entries[0].boxes[i].data);
            var hvcCUint8 = new Uint8Array(hvcC);
            trak.mdia.minf.stbl.stsd.entries[0].boxes[i].data = hvcCUint8;
            trak.mdia.minf.stbl.stsd.entries[0].boxes[i].size = hvcC.byteLength + 8;
            break;
        }
    }

    // todo: deal with other stuff

    moov.boxes.push(trak);
    moov.traks.push(trak);
    var fragment_duration = (this.moov.mvex && this.moov.mvex.mehd ? this.moov.mvex.mehd.fragment_duration : undefined);
    var default_sample_duration = (this.moov.traks[0].samples.length > 0 ? this.moov.traks[0].samples[0].duration : 0);
    if (default_sample_duration === 0){
        try {
            default_sample_duration = this.moov.mvex.trexs[0].default_sample_duration;
        } catch (er) {}
    }
    
    var buffer = ISOFile.writeInitializationSegment(ftyp, moov, fragment_duration, default_sample_duration);
    return buffer;
}

ISOFile.prototype.createHEVCConfigRecord = function(data){
    // parse hvcC and copy data if the values are good for us
    var stream = new DataStream(data, 0, DataStream.BIG_ENDIAN);
    var streamOut = new DataStream();
    streamOut.endianness = DataStream.BIG_ENDIAN;
    
    myHvcC = {};
    var i, j;
    var nb_nalus;
    var length;
    var tmp_byte;
    myHvcC.configurationVersion = stream.readUint8();
    streamOut.writeUint8(myHvcC.configurationVersion);

    tmp_byte = stream.readUint8();
    streamOut.writeUint8(tmp_byte);
    myHvcC.general_profile_space = tmp_byte >> 6;
    myHvcC.general_tier_flag = (tmp_byte & 0x20) >> 5;
    myHvcC.general_profile_idc = (tmp_byte & 0x1F);

    myHvcC.general_profile_compatibility = stream.readUint32();
    streamOut.writeUint32(myHvcC.general_profile_compatibility);

    myHvcC.general_constraint_indicator = stream.readUint8Array(6);
    streamOut.writeUint8Array(myHvcC.general_constraint_indicator);

    myHvcC.general_level_idc = stream.readUint8();
    streamOut.writeUint8(myHvcC.general_level_idc);

    myHvcC.min_spatial_segmentation_idc = stream.readUint16() & 0xFFF;
    streamOut.writeUint16(myHvcC.min_spatial_segmentation_idc);

    myHvcC.parallelismType = (stream.readUint8() & 0x3);
    streamOut.writeUint8(myHvcC.parallelismType);

    myHvcC.chroma_format_idc = (stream.readUint8() & 0x3);
    streamOut.writeUint8(myHvcC.chroma_format_idc);

    myHvcC.bit_depth_luma_minus8 = (stream.readUint8() & 0x7);
    streamOut.writeUint8(myHvcC.bit_depth_luma_minus8);

    myHvcC.bit_depth_chroma_minus8 = (stream.readUint8() & 0x7);
    streamOut.writeUint8(myHvcC.bit_depth_chroma_minus8);

    myHvcC.avgFrameRate = stream.readUint16();
    streamOut.writeUint16(myHvcC.avgFrameRate);

    tmp_byte = stream.readUint8();
    streamOut.writeUint8(tmp_byte);
    myHvcC.constantFrameRate = (tmp_byte >> 6);
    myHvcC.numTemporalLayers = (tmp_byte & 0XD) >> 3;
    myHvcC.temporalIdNested = (tmp_byte & 0X4) >> 2;
    myHvcC.lengthSizeMinusOne = (tmp_byte & 0X3);

    myHvcC.nalu_arrays = [];
    var numOfArrays = stream.readUint8();
    if(numOfArrays !== 3){
        Log.warn("MP4BoxExtension", "hvcC should have exactly 3 NALs (VPS,SPS and PPS) and it has " + 
        numOfArrays + ". All NALUs which are not parameter sets will be removed.");
    }
    streamOut.writeUint8(3);

    for (i = 0; i < numOfArrays; i++) {
        var nalu_array = [];
        myHvcC.nalu_arrays.push(nalu_array);
        tmp_byte = stream.readUint8()
        nalu_array.completeness = (tmp_byte & 0x80) >> 7;
        nalu_array.nalu_type = tmp_byte & 0x3F;
        var numNalus = stream.readUint16();

        if (32 === nalu_array.nalu_type || 33 === nalu_array.nalu_type || 34 === nalu_array.nalu_type) {
            streamOut.writeUint8(tmp_byte);
            streamOut.writeUint16(numNalus);
        }

        for (j = 0; j < numNalus; j++) {
            var nalu = {}
            nalu_array.push(nalu);
            length = stream.readUint16();
            nalu.data = stream.readUint8Array(length);
            if (32 === nalu_array.nalu_type || 33 === nalu_array.nalu_type || 34 === nalu_array.nalu_type) {
                streamOut.writeUint16(length);
                streamOut.writeUint8Array(nalu.data);
            }
        }
    }
    return streamOut.buffer;
}

// this is a copy of mp4box.js where this.version = 0 is removed (I don't get it why they did it)
BoxParser.trunBox.prototype.write = function(stream) {
	this.size = 4;
	if (this.flags & BoxParser.TRUN_FLAGS_DATA_OFFSET) {
		this.size += 4;
	}
	if (this.flags & BoxParser.TRUN_FLAGS_FIRST_FLAG) {
		this.size += 4;
	}
	if (this.flags & BoxParser.TRUN_FLAGS_DURATION) {
		this.size += 4*this.sample_duration.length;
	}
	if (this.flags & BoxParser.TRUN_FLAGS_SIZE) {
		this.size += 4*this.sample_size.length;
	}
	if (this.flags & BoxParser.TRUN_FLAGS_FLAGS) {
		this.size += 4*this.sample_flags.length;
	}
	if (this.flags & BoxParser.TRUN_FLAGS_CTS_OFFSET) {
		this.size += 4*this.sample_composition_time_offset.length;
	}
	this.writeHeader(stream);
	stream.writeUint32(this.sample_count);
	if (this.flags & BoxParser.TRUN_FLAGS_DATA_OFFSET) {
		this.data_offset_position = stream.getPosition();
		stream.writeInt32(this.data_offset); //signed
	}
	if (this.flags & BoxParser.TRUN_FLAGS_FIRST_FLAG) {
		stream.writeUint32(this.first_sample_flags);
	}
	for (var i = 0; i < this.sample_count; i++) {
		if (this.flags & BoxParser.TRUN_FLAGS_DURATION) {
			stream.writeUint32(this.sample_duration[i]);
		}
		if (this.flags & BoxParser.TRUN_FLAGS_SIZE) {
			stream.writeUint32(this.sample_size[i]);
		}
		if (this.flags & BoxParser.TRUN_FLAGS_FLAGS) {
			stream.writeUint32(this.sample_flags[i]);
		}
		if (this.flags & BoxParser.TRUN_FLAGS_CTS_OFFSET) {
			if (this.version === 0) {
				stream.writeUint32(this.sample_composition_time_offset[i]);
			} else {
				stream.writeInt32(this.sample_composition_time_offset[i]); //signed
			}
		}
	}		
}