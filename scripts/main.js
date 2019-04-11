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

'use strict';

var app = angular.module('OMAFPlayer', ['ngResource']);

// load manifests.json
app.factory('manifests', ['$resource', function($resource) {
  return $resource('manifests.json', {}, {
    query: { method: 'get', isArray: false, cancellable: true}
  });
}]);

app.controller('OMAFController', function ($scope, manifests){

  $scope.player = window.player = new OMAFPlayer();
  $scope.video = document.querySelector('.omaf-player #video1');
  $scope.renderEle = document.querySelector('.omaf-player #renderingSurface');
  $scope.cameraControlElement = document.querySelector('.omaf-player #videobox');

  // get metrics update interval
  $scope.metricsInterval = 1000;
  var metricsIntControl = document.getElementById("inputMetricsUpdate");
  if (metricsIntControl !== null){
    $scope.metricsInterval = metricsIntControl.value;
    metricsIntControl.addEventListener("change", function(){
      $scope.metricsInterval = this.value;
    });
  }

  // get chart window size
  $scope.chartWindowSize = 100;
  var chartWindowSizeControl = document.getElementById("inputChartWindow");
  if (chartWindowSizeControl !== null){
    $scope.chartWindowSize = chartWindowSizeControl.value;
    chartWindowSizeControl.addEventListener("change", function(){
      $scope.chartWindowSize = this.value;
    });
  }

  // get log level
  $scope.logLevel = window.logLevel = Log.error; 
  var logLevelControl = document.getElementById("logLevelSelect");
  if (logLevelControl !== null){
    logLevelControl.addEventListener("change", function(){
      if(this.value === "error"){
        $scope.logLevel = Log.error;
      } else if(this.value === "warn"){
        $scope.logLevel = Log.warn;
      } else if(this.value === "info"){
        $scope.logLevel = Log.info;
      } else if(this.value === "debug"){
        $scope.logLevel = Log.debug;
      }
      Log.setLogLevel($scope.logLevel);
      window.logLevel = $scope.logLevel;
    });
  }

  Log.setLogLevel($scope.logLevel);
  //window.logLevel = Log.warn;
  //Log.setLogLevel(Log.warn);

  // get render cube wireframe
  var renderDebugControl = document.getElementById("renderDebug");
  if (renderDebugControl !== null){
    $scope.player.setRenderDebugInfo(renderDebugControl.checked);
    renderDebugControl.addEventListener("change", function(){
      $scope.player.setRenderDebugInfo(this.checked);
    });
  }


  // let the use know which version we are using now
  $scope.version = $scope.player.getVersion();
  
  $scope.selectedMPD = { 
    url: 'please select DASH Manifest (MPD) or provide it\'s URL in this field'
  };

  manifests.query(function (data) { $scope.availableMPDs = data.mpds; });

  $scope.setMPD = function (item) { $scope.selectedMPD = JSON.parse(JSON.stringify(item)); };

  // chart js stuff
  google.charts.load('current', {packages: ['corechart', 'line']});
  google.charts.setOnLoadCallback(function(){
    $scope.chart = new google.visualization.LineChart(document.getElementById('chart_div'));
    $scope.chartData = new google.visualization.DataTable();
    $scope.initChartData();
    $scope.drawChart();
  });


  $(window).resize(function(){
    $scope.drawChart();
  });

  $scope.player.onInit = function (){
    // start metrics pulling
    updateMetrics();
  }
  // start-up values for metrics
  $scope.yaw = 0;
  $scope.pitch = 0;
  $scope.trackID = 0;
  $scope.segNr = 0;

  $scope.doLoop = function ($event) {
    $scope.player.loop($event.target);
  };

  $scope.doLoad = function () {
    Log.info("OMAFController", "Load MPD");
    Log.warn("OMAFController",$scope.selectedMPD.index)
    var span = document.getElementById("iconPlayPause");
    if (span !== null && $scope.player.initialized) {
      if($scope.player.isPlaying){
        span.classList.remove('fa-pause');
        span.classList.add('fa-play');
        $scope.player.pause();
      }
    }
    $scope.player.reset();

    $scope.player.init($scope.video, $scope.renderEle, $scope.cameraControlElement, $scope.bufferLimit);
    $scope.player.start($scope.selectedMPD.url);

    $scope.loadTimestamp = Date.now();
    var rowCnt = $scope.chartData.getNumberOfRows();
    $scope.chartData.removeRows(0, rowCnt);
  };

  $scope.doFullscreen = function () {
    Log.info("OMAFController", "change Full screen");
    $scope.player.changeFullScreen();
  };

  $scope.doPlayPause = function () {
    var span = document.getElementById("iconPlayPause");
        if (span !== null && $scope.player.initialized) {
            if($scope.player.isPlaying){
                span.classList.remove('fa-pause');
                span.classList.add('fa-play');
                $scope.player.pause();
            } else{
                span.classList.remove('fa-play');
                span.classList.add('fa-pause');
                $scope.player.play();
            }
        }
  };

  function updateMetrics() {
    var metrics = $scope.player.getMetrics();

    $scope.yaw= metrics.yaw.toFixed(2);
    $scope.pitch = metrics.pitch.toFixed(2);
    $scope.trackID = metrics.trackID;
    $scope.segNr = metrics.segNr;
    // etc.

    // now put data to chart
    var diff = $scope.chartData.getNumberOfRows() - $scope.chartWindowSize;
    if(diff > 0){
      $scope.chartData.removeRows(0, diff);
    }
    $scope.chartData.addRow([ Date.now() - $scope.loadTimestamp, parseInt($scope.yaw), parseInt($scope.pitch)]);
    $scope.drawChart();

    // schedule next metrics pulling
    setTimeout(function () {
      $scope.$apply(function(){
        updateMetrics();
      })
    }, $scope.metricsInterval);
  }

  $scope.initChartData = function(){
    $scope.chartData.addColumn('number', 'Time');
    $scope.chartData.addColumn('number', 'Yaw');
    $scope.chartData.addColumn('number', 'Pitch');
  }

  $scope.drawChart = function(){
    if(!$scope.chart || !$scope.chartData) { return; }
    $scope.chart.draw($scope.chartData, { hAxis: { title: 'Time [ms]'}, vAxis: { title: 'Angle'}});
  }
});

$(document).ready(function () {});