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

var omafNS = "urn:mpeg:mpegI:omaf:2017";

function MPDParser() {
    this.initialized = false;
    this.xmlDoc = null;
    this.projection_type = null;
    this.viewportAS = {}; // list of extractor track AS. key=ASID, value=AS
    this.viewportDep = {}; // list of viewport dependencies
    this.tilesAS = {}; // list of tile AS
    this.viewPortBestRegion = {}; // this contains the best quality region vector.
    this.lastSegNr = -1; // this is set once MPD is parsed and duration + segmentTemplate data is evaluated
    this.periodDuration = 0; // in seconds

    // events
    this.onInit = null;
}

MPDParser.prototype.secondsFromIsoDuration = function(duration) {
    var regex = /P((([0-9]*\.?[0-9]*)Y)?(([0-9]*\.?[0-9]*)M)?(([0-9]*\.?[0-9]*)W)?(([0-9]*\.?[0-9]*)D)?)?(T(([0-9]*\.?[0-9]*)H)?(([0-9]*\.?[0-9]*)M)?(([0-9]*\.?[0-9]*)S)?)?/
    var matches = duration.match(regex);
    var hours   = parseFloat(matches[12]) || 0;
    var minutes = parseFloat(matches[14]) || 0;
    var seconds = parseFloat(matches[16]) || 0;
    return (hours*3600 + minutes*60 + seconds);
}

MPDParser.prototype.init = function (xmlDoc) {
    if (this.initialized){
        Log.warn("MPDParser", "Parser was already initialized.");
        return;
    }
    Log.info("MPDParser", "start MPD parsing");
    this.xmlDoc = xmlDoc;

    var adaptationSets = xmlDoc.getElementsByTagName("AdaptationSet");
    var essentialProps = xmlDoc.getElementsByTagName("EssentialProperty");
    // var supplementProps = xmlDoc.getElementsByTagName("SupplementalProperty");

    var pDurStr = xmlDoc.getElementsByTagName("Period")[0].getAttribute("duration");
    this.periodDuration = this.secondsFromIsoDuration(pDurStr);

    try{
        this.lastSegNr = this.getLastSegmentNr();
    }
    catch(e){
        ErrorPopUp("Could not parse last segment number. Make sure you use the correct MPD (with SegmentTemplate)");
        return;
    }

    if (adaptationSets.length === 0){
        ErrorPopUp("No AdaptationSets found in the manifest");
        return;
    }

    // iterate all essential porperties
    for(var i = 0; i < essentialProps.length; i++){
        var parentEl = essentialProps[i].parentElement;
        if(null == parentEl){ continue; }
        
        // get projection type
        if(parentEl.nodeName === "MPD"){
            var pr = essentialProps[i].getAttributeNS(omafNS, "projection_type");
            if(pr && !this.projection_type){
                this.projection_type = parseInt(pr);
            }
            else if(pr && this.projection_type){
                ErrorPopUp("Multiple projection formats found in the manifest");
                return;
            }
        }
    }

    // get full coverage viewport-dependent AS with hvc2
    for (var i = 0; i < adaptationSets.length; i++){
        var codecs = adaptationSets[i].getAttribute("codecs");
        var cc = adaptationSets[i].getElementsByTagNameNS(omafNS, "cc");
        var srqr = adaptationSets[i].getElementsByTagNameNS(omafNS, "sphRegionQuality");
        var hvc2Found = codecs.indexOf("ercm.hvc2");
        var hvc1Found = codecs.indexOf("ercm.hvc1");

        var asID = adaptationSets[i].getAttribute("id");
        // get stuff related to viewport adaptation sets
        if (cc.length === 0 && srqr.length > 0 && hvc2Found !== -1){
            this.viewportAS[asID] = adaptationSets[i];

            var suplPropsTemp = adaptationSets[i].getElementsByTagName("SupplementalProperty");
            for(var j=0; j< suplPropsTemp.length; j++){
                if (suplPropsTemp[j].getAttribute("schemeIdUri") ==="urn:mpeg:dash:preselection:2016"){
                    var deps = [];
                    var val = suplPropsTemp[j].getAttribute("value").split(",")[1].split(" ");
                    // todo: iterate over values skip first and check if empty
                    for(var n = 1; n<val.length; n++){
                        var temp = parseInt(val[n]);
                        if(!isNaN(temp)){
                            deps.push(temp);
                        }
                    }
                    this.viewportDep[asID] = deps;
                }
            }

            if (srqr.length > 1){
                Log.warn("MPDParser", "More than one sphRegionQuality found. Multiple shape_types are not supported yet. Select first one.");
            }
            var regions = srqr[0].getElementsByTagNameNS(omafNS, "qualityInfo");
            var az = null;
            var el = null;
            var lowestQualRanking = null;
            for(var j=0; j< regions.length; j++){
                var qr = parseInt(regions[j].getAttribute("quality_ranking"));
                if (null == lowestQualRanking || qr < lowestQualRanking){
                    lowestQualRanking = qr;
                    az = THREE.Math.degToRad(parseInt(regions[j].getAttribute("centre_azimuth")) / 65536.0);
                    el = THREE.Math.degToRad(parseInt(regions[j].getAttribute("centre_elevation")) / 65536.0);
                }else if(qr == lowestQualRanking ){
                    if(parseInt(regions[j].getAttribute("centre_azimuth"))){
                        az += THREE.Math.degToRad(parseInt(regions[j].getAttribute("centre_azimuth")) / 65536.0);
                    }
                    if(parseInt(regions[j].getAttribute("centre_elevation"))){
                        el += THREE.Math.degToRad(parseInt(regions[j].getAttribute("centre_elevation")) / 65536.0);
                    }
                }
            }
            this.viewPortBestRegion[asID] = new THREE.Vector3( Math.cos(el)*Math.cos(az), Math.cos(el)*Math.sin(az), Math.sin(el) );
        }

        // get tile adaptation sets 'hvc1'
        if (cc.length !== 0 || hvc1Found !== -1){
            this.tilesAS[asID] = adaptationSets[i];
        }
    }

    Log.info("MPDParser", "MPD parsing finished");
    this.initialized = true;
    if(this.onInit == null){
        Log.warn("MPDParser", "OnInit callback not set");
    }
    else{
        this.onInit();
    }
}

MPDParser.prototype.getBestRegionVectors = function(){
    return this.viewPortBestRegion;
}

MPDParser.prototype.getNumberOfViewports = function(){
    return Object.keys(this.viewportAS).length;
}

MPDParser.prototype.getNumberOfTiles = function () {
    return Object.keys(this.tilesAS).length;
}

MPDParser.prototype.getProjection = function(){
    return this.projection_type;
}

MPDParser.prototype.getViewportAS = function(asID){
    if (this.viewportAS.hasOwnProperty(asID)) {
        return this.viewportAS[asID];
    }
    return null;
}

MPDParser.prototype.getDependencies = function (asID) {
    if (this.viewportDep.hasOwnProperty(asID)) {
        return this.viewportDep[asID];
    }
    return null;
}

MPDParser.prototype.getTileAS = function (asID) {
    if (this.tilesAS.hasOwnProperty(asID)) {
        return this.tilesAS[asID];
    }
    return null;
}

// for now only SegmentTemplate is supported
MPDParser.prototype.getVPinitSegURLs = function(){
    var asIDs = [];
    var urls = [];
    var key;
    for (key in this.viewportAS){
        var adaptSet = this.getViewportAS(key);
        if (null == adaptSet){
            ErrorPopUp("No viewport adaptation found <br> AdaptationSet id = " + key);
            throw "MPDParsingError"; 
        }
        var reps = adaptSet.getElementsByTagName("Representation");
        if(reps.length !== 1){
            ErrorPopUp("Only one representation is supported for viewport adaptation sets <br> AdaptationSet id = " + key);
            throw "MPDParsingError";
        }

        var segTemplate = reps[0].getElementsByTagName("SegmentTemplate");
        if (segTemplate.length > 1) {
            ErrorPopUp("Only one SegmentTemplate is supported inside a Representation. <br> AdaptationSet id = " + key);
            throw "MPDParsingError";
        } 
        else if(segTemplate.length === 0){
            ErrorPopUp("Only SegmentTemplate is supported for now. Others TBD.");
            throw "MPDParsingFeatrureNotImplemented";
        }
        asIDs.push(key);
        urls.push(segTemplate[0].getAttribute("initialization"));
    }
    return {"asIDs": asIDs, "urls": urls};
}

MPDParser.prototype.getASIDfromYawPitch = function(yawRad, pitchRad){
    var posVec = new THREE.Vector3( Math.cos(pitchRad)*Math.cos(yawRad), 
                                    Math.cos(pitchRad)*Math.sin(yawRad), 
                                    Math.sin(pitchRad) );
    var asID = null;
    var minDistance = null;
    for (key in this.viewPortBestRegion){
        var distance = posVec.distanceToSquared( this.viewPortBestRegion[key] );
        if (null == minDistance || distance < minDistance){
            minDistance = distance;
            asID = key;
        }
    }
    return asID;
}

MPDParser.prototype.getASfromYawPitch = function (yawDeg, pitchDeg){
    var asID = this.getASIDfromYawPitch(yawDeg, pitchDeg);
    return this.getViewportAS(asID);
}

// just download get the URLs from lowest representation
MPDParser.prototype.getMediaRequestsSimple = function (yawDeg, pitchDeg, segNr){
    if(segNr > this.lastSegNr && this.lastSegNr!=-1){
        Log.warn("MPDParser", "EOF");
        return null;
    }
    var urls = [];
    var adaptSet = this.getASfromYawPitch(yawDeg, pitchDeg);
    var asID = this.getASIDfromYawPitch(yawDeg, pitchDeg);

    var reps = adaptSet.getElementsByTagName("Representation");
    if (reps.length !== 1) {
        ErrorPopUp("Only one representation is supported for viewport adaptation sets <br> AdaptationSet id = " + asID);
        throw "MPDParsingError";
    }
    var segTemplate = reps[0].getElementsByTagName("SegmentTemplate");
    if (segTemplate.length > 1) {
        ErrorPopUp("Only one SegmentTemplate is supported inside a Representation <br> AdaptationSet id = " + asID);
        throw "MPDParsingError";
    }
    else if (segTemplate.length === 0) {
        Log.warn("MPDParser", "Only SegmentTemplate is supported for now. Others TBD.");
        throw "MPDParsingFeatrureNotImplemented";
    }
 
    // todo: check duration
    urls.push(segTemplate[0].getAttribute("media").replace("$Number$", segNr));

    var dependencies = this.getDependencies(asID);
    for (var i = 0; i < dependencies.length; i++){
        var adaptSet = this.getTileAS(dependencies[i]);
        var reps = adaptSet.getElementsByTagName("Representation");
        if (reps.length < 1) {
            ErrorPopUp("No representations found <br> AdaptationSet id = " + dependencies[i]);
            throw "MPDParsingError";
        }
        // no rate adaptation just pick the first one
        var segTemplate = reps[reps.length-1].getElementsByTagName("SegmentTemplate");

        // just for testing if we mix QPs of different tiles
        // if(i>10){
        //     segTemplate = reps[0].getElementsByTagName("SegmentTemplate");
        // }

        if (segTemplate.length > 1) {
            ErrorPopUp("Only one SegmentTemplate is supported inside a Representation <br> AdaptationSet id = " + dependencies[i]);
            throw "MPDParsingError";
        }
        else if (segTemplate.length === 0) {
            Log.warn("MPDParser", "Only SegmentTemplate is supported for now. Others TBD.");
            throw "MPDParsingFeatrureNotImplemented";
        }
        // todo: check duration
        urls.push(segTemplate[0].getAttribute("media").replace("$Number$", segNr));
    }

    // console.log(urls); // debug
    return urls;
}

MPDParser.prototype.getTrackIdFromInitUrl = function (initUrl) {
  var key;
  var trackId;
  for (key in this.viewportAS) {
    var adaptSet = this.getViewportAS(key);
    if (null == adaptSet) {
        ErrorPopUp("No viewport adaptation found <br> AdaptationSet id = " + key);
        throw "MPDParsingError";
    }
    var reps = adaptSet.getElementsByTagName("Representation");
    if (reps.length !== 1) {
        ErrorPopUp("Only one representation is supported for viewport adaptation sets <br> AdaptationSet id = " + key);
        throw "MPDParsingError";
    }

    var segTemplate = reps[0].getElementsByTagName("SegmentTemplate");
    if (segTemplate.length > 1) {
        ErrorPopUp("Only one SegmentTemplate is supported inside a Representation <br> AdaptationSet id = " + key);
        throw "MPDParsingError";
    }
    else if (segTemplate.length === 0) {
        Log.warn("MPDParser", "Only SegmentTemplate is supported for now. Others TBD.");
        throw "MPDParsingFeatrureNotImplemented";
    }
    if (initUrl == segTemplate[0].getAttribute("initialization")) {
        trackId = key;
    }
  }
  return trackId;
}

MPDParser.prototype.getFramesPerSegment = function(fps){
    var segTemplates = this.xmlDoc.getElementsByTagName("SegmentTemplate");
    var timeScale = parseInt(segTemplates[0].getAttribute("timescale"));
    var duration = parseInt(segTemplates[0].getAttribute("duration"));
    return duration / timeScale * fps;
}

MPDParser.prototype.getLastSegmentNr = function(){
    var segTemplates = this.xmlDoc.getElementsByTagName("SegmentTemplate");
    var startNr = parseInt(segTemplates[0].getAttribute("startNumber"));
    var duration = parseInt(segTemplates[0].getAttribute("duration"));
    var timeScale = parseFloat(segTemplates[0].getAttribute("timescale"));
    return this.periodDuration / (duration/timeScale) + startNr - 1;
}

MPDParser.prototype.getFirstSegmentNr = function() {
    var segTemplates = this.xmlDoc.getElementsByTagName("SegmentTemplate");
    var startNr = parseInt(segTemplates[0].getAttribute("startNumber"));
    return startNr;
}

MPDParser.prototype.getFPS = function(){
    var fps = null;
    for (key in this.viewportAS) {
        var adaptSet = this.getViewportAS(key);
        var reps = adaptSet.getElementsByTagName("Representation");
        if (reps.length !== 1) {
            ErrorPopUp("Only one representation is supported for viewport adaptation sets <br> AdaptationSet id = " + key);
            throw "MPDParsingError";
        }

        var repFramerate = reps[0].getAttribute("frameRate");
        if(!repFramerate){
            Log.warn("MPDParser", "frameRate not set in VP representation.");
            return null;
        }

        if (null == fps) {
            fps = parseInt(repFramerate);
        }

        if (fps !== parseInt(repFramerate)){
            Log.warn("MPDParser", "frameRate attribute in different VP Representations has different values.");
        }
    }
    return fps;
}

MPDParser.prototype.getMimeType = function(){
    var mimeType = null;
    for (key in this.viewportAS) {
        var adaptSet = this.getViewportAS(key);
        var codecs = adaptSet.getAttribute("codecs");
        if (null == codecs) {
            ErrorPopUp("No codecs found <br> AdaptationSet id = " + key);
            throw "MPDParsingError";
        }
        if(null == mimeType){
            mimeType = codecs;
        }
        if(codecs != mimeType){
            Log.warn("MPDParser", "codecs attribute is not the same in all viewport AdaptationSets");
        }
    }

    if (typeof mimeType === 'string' || mimeType instanceof String){
        var idx = mimeType.indexOf("hvc2");
        var temp = mimeType.substring(idx).replace("hvc2", "hvc1");
        mimeType = 'video/mp4; codecs="' + temp + '"';
    }
    return mimeType;
}

MPDParser.prototype.reset = function(){
    delete this.initialized;
    delete this.xmlDoc;
    delete this.projection_type ;
    delete this.viewportAS; 
    delete this.viewportDep; 
    delete this.tilesAS; 
    delete this.viewPortBestRegion; 
    delete this.lastSegNr;
    delete this.periodDuration;
    delete this.onInit;

}