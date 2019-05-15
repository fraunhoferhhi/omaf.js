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

function Fetcher() {
  this.manifestURL = "";
  this.baseURL = "";

  this.onManifestLoaded = null; // onManifestLoaded(xmlDoc)
  this.onInitLoaded = null; // onInitLoaded(arrayOfBinaryObjects)
  this.onMediaLoaded = null; // onMediaLoaded(arrayOfBinaryObjects)
}

Fetcher.prototype.loadManifest = function(url){
  if (this.onManifestLoaded == null) {
    Log.error("DL", "onManifestLoaded callback not set");
    return false;
  }
  Log.info("DL", "Fetch manifest file: " + url);

  var idx = url.lastIndexOf('/');
  if(idx>0){
    this.baseURL = url.substring(0, idx+1);
  }

  fetch(url)
    .then(res => {
      if (!res.ok){
        Log.error("DL", "could not fetch manifest");
        ErrorPopUp("Can not download the manifest file");
        throw "DLerror";
      }
      return res.text();
    })
    .then(str => (new window.DOMParser()).parseFromString(str, "text/xml"))
    .then(data => this.onManifestLoaded(data))
    .catch(err => { 
      ErrorPopUp("Not available url <br> url: " + url);
      throw err; 
    });
    return true;
}

Fetcher.prototype.loadInitSegments = function(urlsWithASIDs){
  if (this.onInitLoaded == null) {
    Log.error("DL", "onInitLoaded callback not set");
    return false;
  }
  if(!urlsWithASIDs){
    Log.error("DL", "init segment URLs are not set");
    ErrorPopUp("please check the init segment urls");
    return false;
  }

  var urls = urlsWithASIDs.urls;
  var numOfRequests = urls.length;
  var resNum = 0;
  var retVal = [];
  var asIDs = [];

  Log.info("DL", "Fetch " + numOfRequests + " init file(s)");
  const multiFetch = url => fetch(this.baseURL + url)
    .then(res => {
      Log.debug("DL", "fetch: " + res.url);
      if (res.ok) {
        return res.arrayBuffer();
      } else {
        throw "Can't download: " + res.url;
      }
    })
    .then(data => {
      resNum++;

      // find out which ASid actually we just downloaded
      for(var i=0; i<numOfRequests; i++){
        if(urlsWithASIDs.urls[i] == url){
          asIDs.push(urlsWithASIDs.asIDs[i]);
          break;
        }
      }

      retVal.push(data);
      if (resNum == numOfRequests) {
        this.onInitLoaded({"data": retVal, "asIDs": asIDs});
      } 
    })
    .catch(err => {
      ErrorPopUp("Not available url <br> url: " + url);
      throw err;
    });

  Promise
    .all(urls.map(multiFetch))

  return true;
}

Fetcher.prototype.loadMediaSegments = function (urls, segNum) {
  if (this.onMediaLoaded == null) {
    Log.error("DL", "onMediaLoaded callback not set");
    return false;
  }
  if (!urls) {
    Log.error("DL", "media segment URLs are not set");
    ErrorPopUp("please check the media segment urls");
    return false;
  }
  var numOfRequests = urls.length;
  var resNum = 0;
  var retVal = [];

  Log.info("DL", "Fetch " + numOfRequests + " media file(s)");

  const multiFetch = url => fetch(this.baseURL + url)
    .then(res => {
      Log.debug("DL", "fetch: " + res.url);
      if (res.ok) {
        return res.arrayBuffer();
      } else {
        throw "Can't download: " + res.url;
      }
    })
    .then(data => {
      
      resNum++;
      retVal.push(data);
      if (resNum == numOfRequests) {
        this.onMediaLoaded(retVal, segNum);
      }
    })
    .catch(err => {
      Log.error("DL", "Something is wrong with media segments." + url);
      //ErrorPopUp("Not available url <br> url: " + url);
      throw err;
    });

  Promise
    .all(urls.map(multiFetch))

  return true;
}

Fetcher.prototype.reset = function () {
  delete this.manifestURL;
  delete this.baseURL;
  delete this.onManifestLoaded; 
  delete this.onInitLoaded; 
  delete this.onMediaLoaded; 
}
