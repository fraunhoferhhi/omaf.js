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

function Metrics() {
  this.initialized = false;
  this.renderedFovSet = null;
  this.displayInfoSet = null;
  this.RenderedViewportList = [];
  this.cqViewportSwitchingLatencyList = [];
  this.viewpointSwitchingLatencyList = [];
  this.oncheckRecentRenderedViewport  = null;
}

function ViewportDataType(vpID, cenAz, cenEl, cenTi, azRange, elRange) {
  this.viewpoint_id = vpID;       // Specifies the identifier of the viewpoint to which the viewport belongs.
                                  // The value of viewpoint is always 'vp1' or Nokia mpd file doesn't have this value. As an alternative, use track id.  
  this.centre_azimuth = cenAz;    // Specifies the azimuth of the centre of the viewport
  this.centre_elevation = cenEl;  // Specifies the elevation of the centre of the viewport 
  this.centre_tilt = cenTi;       // Specifies the tilt angle of the viewport 
  this.azimuth_range = azRange;   // Specifies the azimuth range of the viewport 
  this.elevation_range = elRange; // Specifies the elevation range of the viewport  
}

function RenderedViewport(time, duration, viewport) {
  this.startTime = time;
  this.duration = duration;
  this.viewport = viewport;
}

function CQViewportSwitchingLatency(firV, secV, fitVQ, secVQ, time, latency, reason) {
  this.firstViewport = firV;            // Specifies the spherical region corresponding to the first viewport 
  this.secondViewport = secV;           // Specifies the spherical region corresponding to the second viewport 
  this.firstViewportQuality = fitVQ;    // Specifies the quality value of the first viewport
  this.secondViewportQuality = secVQ;   // Specifies the quality value of the second viewport
  this.t = time;                        // Specifies the measurement time of the viewport switching latency 
  this.latency = latency;               // Specifies the delay in milliseconds between the time a user movement from first viewport to second viewport 
  this.reason = reason;                 // Specifies a list of possible causes for the latency
}
var resonEnum = {
  SEGMENT_DURATION: 0,
  BUFFER_FULLNESS: 1,
  AVAILABLILITY_CQ: 2,
};

function ViewpointSwitchingLatency(targetV, time, latency) {
  this.targetViewport = targetV;
  this.t = time;
  this.latency = latency;
}

Metrics.prototype.init = function (renderedFovH, renderedFovV, resolution) {

  if (this.initialized){
    Log.warn("Metrics", "Metrics was already initialized.");
    return;
  }

  this.renderedFovSet = {
    renderedFovH: renderedFovH, // The horizontal element of the rendered FOV, in units of degrees 
    renderedFovV: renderedFovV  // The vertical element of the rendered FOV, in units of degrees
  };
  
  this.displayInfoSet = {
    displayResolution: resolution,    // Display resolution, in units of pixels
    displayPixelDensity: null,  // Display pixel density, in units of PPI
    displayRefreshRate: null    // Display refresh rate, in units of Hz
  }; 


}

Metrics.prototype.updateResolution = function (resolution) {
  if (!resolution || resolution === ""){
    Log.warn("Metrics", "No resolution value.");
    return;
  }
  this.displayInfoSet.displayResolution = resolution;
}
Metrics.prototype.updateRefreshRate = function (rate) {
  if (!rate){
    Log.warn("Metrics", "No RefreshRate value.");
    return;
  }
  this.displayInfoSet.displayRefreshRate = rate;
}
Metrics.prototype.updateLongestRenderedViewport = function (time, duration, viewport) {
  if (!duration || !viewport){
    Log.warn("Metrics", "No RenderedViewport value.");
    return;
  }
  this.RenderedViewportList.push(new RenderedViewport(time, duration, viewport));
}

Metrics.prototype.checkLongestRenderedViewport = function () {
  this.onCheckRecentRenderedViewport(this.RenderedViewportList);
}

Metrics.prototype.updateCQViewportSwitchingLatency = function (cqObj) {
  if (!cqObj){
    Log.warn("Metrics", "No RenderedViewport value.");
    return;
  }
  this.cqViewportSwitchingLatencyList.push(cqObj);
}

Metrics.prototype.reset = function () {

  delete this.RenderedViewportList;
  delete this.cqViewportSwitchingLatencyList;
  delete this.viewpointSwitchingLatencyList;
  this.RenderedViewportList = [];
  this.cqViewportSwitchingLatencyList = [];
  this.viewpointSwitchingLatencyList = []
}