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

function Renderer() {
  this.projection_type = null;
  this.camera   = null;
  this.scene    = null;
  this.subScene = null;
  this.webGLRenderer  = null;
  this.subWebGLRenderer  = null;
  this.videoElement   = null;
  this.subVideoElement  = null;
  this.videoTexture   = null;
  this.subVideoTexture  = null;
  this.projArrtexture   = [];
  this.packArrtexture   = [];
  this.rotateArrtexture = [];
  this.projArrtextureData   = [];
  this.packArrtextureData   = [];
  this.rotateArrtextureData = [];
  this.material       = null;
  this.subMaterial    = null;
  this.mesh     = null;
  this.subMesh  = null;
  this.effect   = null;
  this.geometry = null;
  this.subGeometry = null;
  this.controls = null;
  this.arrProjRegions     = {};
  this.arrPackedRegions   = {};
  this.arrRotates     = {};
  this.allTracksRwpk  = {};
  this.initialized    = false;
  this.isAniPause     = false;
  this.isSub    = false;
  this.aniReq   = null;
  this.resizeReq      = null;
  this.maxCurTime     = 0;
  this.setIsSwitch      = false;

  this.renderDebug = false;     // if set to true, render some additional debug info on top
  this.debugScene = null;
  this.stats = null;

  this.onInit   = null;
  this.onSwitchRender = null;
}

Renderer.prototype.getFragmentShader = function(){
  return `
  #ifdef GL_ES
    precision mediump float;
  #endif
    varying vec2 vUv;
    uniform sampler2D uniTexture;
    uniform sampler2D uniProjTexture;
    uniform sampler2D uniPackTexture;
    uniform sampler2D uniRotateTexture;
    uniform float uniMniHeight;
    const float MAX_ITERATIONS = 100.0;
    
    void main() 
    {
      vec2 texCoord = vUv ;  
      float tempRotate;
      vec4 tempProjReigon;
      vec4 tempPackedReigon;
      for(float i = 0.0; i < MAX_ITERATIONS ; i++)
      {
        float edgey = i * uniMniHeight;
        tempProjReigon = texture2D(uniProjTexture, vec2(1.0,edgey));
        tempPackedReigon = texture2D(uniPackTexture, vec2(1.0,edgey));
        tempRotate = texture2D(uniRotateTexture, vec2(1.0,edgey)).a;

        if (texCoord.x > tempProjReigon.x && texCoord.x < tempProjReigon.x + tempProjReigon.z &&
            texCoord.y > tempProjReigon.y && texCoord.y < tempProjReigon.y + tempProjReigon.w)
        {
          float sin_factor = sin(tempRotate);
          float cos_factor = cos(tempRotate);
          vec2 rotateRatio =  mat2(cos_factor, sin_factor, -sin_factor, cos_factor) * vec2( ((float(texCoord.x)- float(tempProjReigon.x)) / float(tempProjReigon.z)) - 0.5, ((float(texCoord.y)- float(tempProjReigon.y)) / float(tempProjReigon.w)) - 0.5);
          rotateRatio += 0.5;
          
          texCoord.x = float(tempPackedReigon.x) + (float(rotateRatio.x) * float(tempPackedReigon.z));
          texCoord.y = float(tempPackedReigon.y) + (float(rotateRatio.y) * float(tempPackedReigon.w));
          gl_FragColor = texture2D( uniTexture, texCoord );

          return;
        }  
      }
    }
  `;
}

Renderer.prototype.getVertexShader = function(){
  return `
    varying vec2 vUv;
    void main() 
    {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }
  `;
}

Renderer.prototype.setDebug = function(flag){
  this.renderDebug = flag;
}

// projection_type: 0-ERP, 1-CMP
Renderer.prototype.init = function (projection_type, video, subVideo, renderEle, subRenderEle, cameraEle, fps, framePerSeg, rwpk, mpdVectors) {
  if(projection_type == null || projection_type > 1){
    Log.error("Renderer", "projection type not supported: " + projection_type);
    return false;
  }
  if (this.onInit == null) {
    Log.error("Renderer", "onInit callback not set");
    return false;
  }
  if (!video) {
    Log.error("Renderer", "Video element is undefined.");
    return false;
  }
  if (!rwpk) {
    Log.error("Renderer", "rwpk is undefined.");
    return false;
  }
  if (this.initialized) {
    Log.warn("Renderer", "Renderer was already initialized.");
    return;
  }
  if (!fps) {
    Log.warn("Renderer", "fps is undefined.");
  }
  if (!framePerSeg) {
    Log.warn("Renderer", "framePerSegment is undefined.");
  }
  if(!WEBGL.isWebGLAvailable()){
    Log.error("Renderer", "This device or browser does not support WebGL.");
    $("#modalMessage").html("This device or browser does not support WebGL");
    $("#warningPopup").modal();
    return;
  }
  if(!(window.requestAnimationFrame || window.webkitRequestAnimationFrame || window.mozRequestAnimationFrame)){
    Log.error("Renderer", "Don't support requestAnimationFrame.");
    $("#modalMessage").html("This device or browser does not support requestAnimationFrame method" );
    $("#warningPopup").modal();
    return;
  }
 

  var self = this;
  this.videoElement = video;
  this.subVideoElement = subVideo;

  this.allTracksRwpk = rwpk;
 
  this.scene = new THREE.Scene();
  this.subScene = new THREE.Scene();
  this.debugScene = new THREE.Scene();

  var cameraElement = cameraEle;
  this.camera = new THREE.PerspectiveCamera(70, $(cameraElement).width() / $(cameraElement).height(), 1, 1000);
  this.camera.position.z = 0.001;

  this.videoTexture = new THREE.VideoTexture(this.videoElement);
  this.videoTexture.minFilter = THREE.LinearFilter;
  this.videoTexture.magFilter = THREE.LinearFilter;
  
  this.subVideoTexture = new THREE.VideoTexture(this.subVideoElement);
  this.subVideoTexture.minFilter = THREE.LinearFilter;
  this.subVideoTexture.magFilter = THREE.LinearFilter;


  var canvas = renderEle;
  this.webGLRenderer = new THREE.WebGLRenderer({"canvas": canvas});
  this.webGLRenderer.setSize($(canvas).width(), $(canvas).height(), false);

  var subCanvas = subRenderEle;
  this.subWebGLRenderer = new THREE.WebGLRenderer({"canvas": subCanvas});
  this.subWebGLRenderer.setSize($(canvas).width(), $(canvas).height(), false);

  this.projection_type = projection_type;

  if(this.projection_type == 0){

    this.geometry = new THREE.SphereGeometry( 100, 60, 60 );
    this.geometry.rotateY(Math.PI / 2.0);
    this.geometry.scale( - 1, 1, 1 );

    this.subGeometry = new THREE.SphereGeometry( 100, 60, 60 );
    this.subGeometry.rotateY(Math.PI / 2.0);
    this.subGeometry.scale( - 1, 1, 1 );



    this.material = new THREE.ShaderMaterial( {

      uniforms: {
        uniTexture: { value: self.videoTexture },
        uniProjTexture: { value: null },
        uniPackTexture: { value: null },
        uniRotateTexture: { value: null },
        uniMniHeight: { value: null}
      },
    
      vertexShader: this.getVertexShader(),
      fragmentShader: this.getFragmentShader()
    } );

    
    this.subMaterial = new THREE.ShaderMaterial( {

      uniforms: {
        uniTexture: { value: self.subVideoTexture },
        uniProjTexture: { value: null },
        uniPackTexture: { value: null },
        uniRotateTexture: { value: null },
        uniMniHeight: { value: null}
      },
    
      vertexShader: this.getVertexShader(),
      fragmentShader: this.getFragmentShader()
    } );

    this.initRWPKInfo();

  }else if (this.projection_type == 1){
 
    this.geometry = new THREE.BoxGeometry( 10, 10, 10 );
    //this.geometry = new THREE.PlaneGeometry( 150, 100);
    //this.camera.position.set( 0, 0, 70);

    this.subGeometry = new THREE.BoxGeometry( 10, 10, 10 );
    this.initCubeFace();

    this.material = new THREE.ShaderMaterial( {

      uniforms: {
        uniTexture: { value: self.videoTexture },
        uniProjTexture: { value: null },
        uniPackTexture: { value: null },
        uniRotateTexture: { value: null },
        uniMniHeight: { value: null}
      },
    
      vertexShader: this.getVertexShader(),
      fragmentShader: this.getFragmentShader(),
      side: THREE.DoubleSide
    } );
    
    this.subMaterial = new THREE.ShaderMaterial( {

      uniforms: {
        uniTexture: { value: self.subVideoTexture },
        uniProjTexture: { value: null },
        uniPackTexture: { value: null },
        uniRotateTexture: { value: null },
        uniMniHeight: { value: null}
      },
    
      vertexShader: this.getVertexShader(),
      fragmentShader: this.getFragmentShader(),
      side: THREE.DoubleSide
    } );

    this.initRWPKInfo();
  }

  this.mesh = new THREE.Mesh(this.geometry, this.material);
  this.subMesh = new THREE.Mesh(this.subGeometry, this.subMaterial);
 
  this.scene.add(this.mesh);
  this.subScene.add(this.subMesh);

  // debug scene
  var geoDebug = new THREE.EdgesGeometry( this.geometry ); // or WireframeGeometry 
  var matDebug = new THREE.LineBasicMaterial( { color: 0xff0000, linewidth: 2, transparent: true } );
  var wireframe = new THREE.LineSegments( geoDebug, matDebug );
  this.debugScene.add( wireframe );
  // debug mpd vectors
  for (key in mpdVectors){
    var dir = mpdVectors[key];
    dir.normalize();
    var origin = new THREE.Vector3( 0, 0, 0 );
    var length = 1;
    var hex = 0xffff00;
    var arrowHelper = new THREE.ArrowHelper( dir, origin, length, hex, 0.1);
    this.debugScene.add( arrowHelper );

    // todo: add labels as in https://codepen.io/dxinteractive/pen/reNpOR
    var mesh = new THREE.Mesh();
    mesh.position.x = dir.x;
    mesh.position.y = dir.y;
    mesh.position.z = dir.z;

    var text = this.createTextLabel();
    text.setHTML("AS " + key);
    text.setParent(mesh);
  }

  this.stats = new Stats();
  var statsDiv = document.getElementById("statsDiv");
  if (statsDiv !== null){
    statsDiv.appendChild( this.stats.dom );
    this.stats.domElement.style.position = 'absolute';
    this.stats.domElement.style.left	= '0px';
    this.stats.domElement.style.bottom	= '0px';
  }


  this.controls = new THREE.OrbitControls(this.camera, cameraElement);
  this.controls.enableZoom = false;
  this.controls.enablePan = false;
  this.controls.enableDamping = true;
  this.controls.rotateSpeed = -0.25;

  this.resizeReq = this.resize(canvas, function () {
    self.webGLRenderer.setSize($(canvas).width(), $(canvas).height(), false);
    self.subWebGLRenderer.setSize($(canvas).width(), $(canvas).height(), false);
    self.camera.aspect = $(canvas).width() / $(canvas).height();
    self.camera.updateProjectionMatrix(); 
  });
  
  this.initialized = true;
  this.onInit();
}


Renderer.prototype.createTextLabel = function(){
  var div = document.createElement('div');
  div.className = 'text-label';
  div.style.position = 'absolute';

  return {
    element: div,
    parent: false,
    position: new THREE.Vector3(0,0,0),
    setHTML: function(html) {
      this.element.innerHTML = html;
    },
    setParent: function(threejsobj) {
      this.parent = threejsobj;
    },
    updatePosition: function() {
      if(parent) {
        this.position.copy(this.parent.position);
      }
      
      var coords2d = this.get2DCoords(this.position, _this.camera);
      this.element.style.left = coords2d.x + 'px';
      this.element.style.top = coords2d.y + 'px';
    },
    get2DCoords: function(position, camera) {
      var vector = position.project(camera);
      vector.x = (vector.x + 1)/2 * window.innerWidth;
      vector.y = -(vector.y - 1)/2 * window.innerHeight;
      return vector;
    }
  };
}



/*
- initialize face vertex of cube 
- requirement for update: consideration of rotation , mirror
*/
Renderer.prototype.initCubeFace = function () {


    var leftFace = [new THREE.Vector2(0, .5), new THREE.Vector2(1/3, .5), new THREE.Vector2(1/3, 1), new THREE.Vector2(0, 1)];
    var frontFace = [new THREE.Vector2(1/3, .5), new THREE.Vector2(2/3, .5), new THREE.Vector2(2/3, 1), new THREE.Vector2(1/3, 1)];
    var rightFace = [new THREE.Vector2(2/3, .5), new THREE.Vector2(1, .5), new THREE.Vector2(1, 1), new THREE.Vector2(2/3, 1)];
    var bottomFace = [new THREE.Vector2(0, 0), new THREE.Vector2(1/3, 0), new THREE.Vector2(1/3, .5), new THREE.Vector2(0, .5)];
    var backFace = [new THREE.Vector2(1/3, 0), new THREE.Vector2(2/3, 0), new THREE.Vector2(2/3, .5), new THREE.Vector2(1/3, .5)];
    var topFace = [new THREE.Vector2(2/3, 0), new THREE.Vector2(1, 0), new THREE.Vector2(1, .5), new THREE.Vector2(2/3, .5)];
  
    /*
    var edgeTL = 0;
    var edgeTR = 1;
    var edgeBR = 2;
    var edgeBL = 3;

    var proj_picture_width = this.allTracksRwpk[Object.keys(this.allTracksRwpk)[0]].proj_picture_width;
    var proj_picture_height = this.allTracksRwpk[Object.keys(this.allTracksRwpk)[0]].proj_picture_height;
    var packed_picture_width = this.allTracksRwpk[Object.keys(this.allTracksRwpk)[0]].packed_picture_width;
    var packed_picture_height = this.allTracksRwpk[Object.keys(this.allTracksRwpk)[0]].packed_picture_height;

    for (var i = 0; i <  this.allTracksRwpk[Object.keys(this.allTracksRwpk)[0]].regions.length; i++) {
      var region = this.allTracksRwpk[Object.keys(this.allTracksRwpk)[0]].regions[i];

    }
   */
    this.geometry.faceVertexUvs[0] = [];
  
    this.geometry.faceVertexUvs[0][0] = [rightFace[2], rightFace[1], rightFace[3]];
    this.geometry.faceVertexUvs[0][1] = [rightFace[1], rightFace[0], rightFace[3]];
  
    this.geometry.faceVertexUvs[0][2] = [leftFace[2], leftFace[1], leftFace[3]];
    this.geometry.faceVertexUvs[0][3] = [leftFace[1], leftFace[0], leftFace[3]];
  
    this.geometry.faceVertexUvs[0][4] = [topFace[1], topFace[0], topFace[2]];
    this.geometry.faceVertexUvs[0][5] = [topFace[0], topFace[3], topFace[2]];
  
    this.geometry.faceVertexUvs[0][6] = [bottomFace[1], bottomFace[0], bottomFace[2]];
    this.geometry.faceVertexUvs[0][7] = [bottomFace[0], bottomFace[3], bottomFace[2]];
  
    this.geometry.faceVertexUvs[0][8] = [backFace[1], backFace[0], backFace[2]];
    this.geometry.faceVertexUvs[0][9] = [backFace[0], backFace[3], backFace[2]];
  
    this.geometry.faceVertexUvs[0][10] = [frontFace[2], frontFace[1], frontFace[3]];
    this.geometry.faceVertexUvs[0][11] = [frontFace[1], frontFace[0], frontFace[3]];

    this.subGeometry.faceVertexUvs[0] = [];
  
    this.subGeometry.faceVertexUvs[0][0] = [rightFace[2], rightFace[1], rightFace[3]];
    this.subGeometry.faceVertexUvs[0][1] = [rightFace[1], rightFace[0], rightFace[3]];
  
    this.subGeometry.faceVertexUvs[0][2] = [leftFace[2], leftFace[1], leftFace[3]];
    this.subGeometry.faceVertexUvs[0][3] = [leftFace[1], leftFace[0], leftFace[3]];
  
    this.subGeometry.faceVertexUvs[0][4] = [topFace[1], topFace[0], topFace[2]];
    this.subGeometry.faceVertexUvs[0][5] = [topFace[0], topFace[3], topFace[2]];
  
    this.subGeometry.faceVertexUvs[0][6] = [bottomFace[1], bottomFace[0], bottomFace[2]];
    this.subGeometry.faceVertexUvs[0][7] = [bottomFace[0], bottomFace[3], bottomFace[2]];
  
    this.subGeometry.faceVertexUvs[0][8] = [backFace[1], backFace[0], backFace[2]];
    this.subGeometry.faceVertexUvs[0][9] = [backFace[0], backFace[3], backFace[2]];
  
    this.subGeometry.faceVertexUvs[0][10] = [frontFace[2], frontFace[1], frontFace[3]];
    this.subGeometry.faceVertexUvs[0][11] = [frontFace[1], frontFace[0], frontFace[3]];

    
}



Renderer.prototype.textureFromFloats = function (gl,float32Array) 
{
  if(!gl.getExtension("OES_texture_float")){
    Log.error("Renderer", "Don't support OES_texture_float");
    $("#modalMessage").html("Don't support OES_texture_float");
    $("#warningPopup").modal();
  }
  
  var oldActive = gl.getParameter(gl.ACTIVE_TEXTURE);
  gl.activeTexture(gl.TEXTURE15); // working register 31, thanks.

  var texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);

  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 
    2, 2, 0, 
    gl.RGBA, gl.FLOAT, float32Array);

  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.bindTexture(gl.TEXTURE_2D, null);

  gl.activeTexture(oldActive);
  
  return texture;
}


/*
- save information of rwpk (proj and unpacked resolution) for shader
*/
Renderer.prototype.initRWPKInfo = function () {

  if (!this.allTracksRwpk[Object.keys(this.allTracksRwpk)[0]]) {
    Log.error("Renderer", "RWPK is undefined.");
    $("#modalMessage").html("Region wise packing metadata is undefined");
    $("#warningPopup").modal();
    return;
  }
  var regionsSize = this.allTracksRwpk[Object.keys(this.allTracksRwpk)[0]].regions.length;

  // 0 - main, 1 - sub
  for (var i = 0 ; i < 2 ; i ++){
    this.projArrtextureData[i] = new Float32Array(regionsSize * 4);
    this.packArrtextureData[i] = new Float32Array(regionsSize * 4);
    this.rotateArrtextureData[i] = new Float32Array(regionsSize);

    this.projArrtexture[i] = new THREE.DataTexture( this.projArrtextureData[i], 1, regionsSize, THREE.RGBAFormat, THREE.FloatType);
    this.projArrtexture[i].needsUpdate = true;
    this.packArrtexture[i] = new THREE.DataTexture( this.packArrtextureData[i], 1, regionsSize, THREE.RGBAFormat, THREE.FloatType);
    this.packArrtexture[i].needsUpdate = true;
    this.rotateArrtexture[i] = new THREE.DataTexture( this.rotateArrtextureData[i], 1, regionsSize, THREE.AlphaFormat, THREE.FloatType);
    this.rotateArrtexture[i].needsUpdate = true;

  }
  
  var proj_picture_width = this.allTracksRwpk[Object.keys(this.allTracksRwpk)[0]].proj_picture_width;
  var proj_picture_height = this.allTracksRwpk[Object.keys(this.allTracksRwpk)[0]].proj_picture_height;
  var packed_picture_width = this.allTracksRwpk[Object.keys(this.allTracksRwpk)[0]].packed_picture_width;
  var packed_picture_height = this.allTracksRwpk[Object.keys(this.allTracksRwpk)[0]].packed_picture_height;

  this.material.uniforms.uniMniHeight.value = 1 / regionsSize;
  this.subMaterial.uniforms.uniMniHeight.value = 1 / regionsSize;
  
  for (key in this.allTracksRwpk) {
    
    this.arrProjRegions[key] = new Float32Array(this.allTracksRwpk[key].regions.length * 4);
    this.arrPackedRegions[key] = new Float32Array(this.allTracksRwpk[key].regions.length * 4);
    this.arrRotates[key] = new Float32Array(this.allTracksRwpk[key].regions.length);

    var offset = 0;

    for (var j = 0; j < this.allTracksRwpk[key].regions.length; j++) {
      var region = this.allTracksRwpk[key].regions[j];
     
      var proj_reg_left = region.proj_reg_left / proj_picture_width;
      var proj_reg_bottom = 1.0 - ((region.proj_reg_top + region.proj_reg_height) / proj_picture_height);
      var proj_reg_width = region.proj_reg_width / proj_picture_width;
      var proj_reg_height = region.proj_reg_height / proj_picture_height;

      var packed_reg_left = (region.packed_reg_left) / packed_picture_width;
      var packed_reg_bottom = 1.0 - (( (region.packed_reg_top) +  region.packed_reg_height) / packed_picture_height);
      var packed_reg_width = (region.packed_reg_width) / packed_picture_width;
      var packed_reg_height = (region.packed_reg_height) / packed_picture_height;

      // half pixel correction to get rid of seams between tiles
      if(packed_reg_left > 0.0){
        packed_reg_left += (1.0 / packed_picture_width) * 0.5;
      }
      if(packed_reg_bottom > 0.0){
        packed_reg_bottom += (1.0 / packed_picture_height) * 0.5;
      }
      if(packed_reg_left + packed_reg_width > 1.0){
        packed_reg_width -= (1.0 / packed_picture_width) * 0.5;
      }else{
        packed_reg_width -= (1.0 / packed_picture_width);
      }
      if(packed_reg_bottom + packed_reg_height > 1.0){
        packed_reg_height -= (1.0 / packed_picture_height) * 0.5;
      }else{
        packed_reg_height -= (1.0 / packed_picture_height);
      }

      offset = 4 * j;
      this.arrProjRegions[key].set([parseFloat(proj_reg_left),parseFloat(proj_reg_bottom),parseFloat(proj_reg_width),parseFloat(proj_reg_height)],offset);
      this.arrPackedRegions[key].set([parseFloat(packed_reg_left),parseFloat(packed_reg_bottom),parseFloat(packed_reg_width),parseFloat(packed_reg_height)],offset);

      var rotateValue = 0;
      switch(region.transform_type){ // todo: add mirroring later.
        case 2:
          rotateValue = -Math.PI;
          break;
        case 5:
          rotateValue = -Math.PI / 2.0;
          break;
        case 7:
          rotateValue = -Math.PI * 1.5;
          break;
        default:
          Log.warn("Renderer", "Transform type: " + region.transform_type + " is not supported yet! The output might look ugly!");
          break;
      }
      this.arrRotates[key][j] = parseFloat(rotateValue);
    }
     
  }
  this.material.uniforms.uniProjTexture.value = this.projArrtexture[0];
  this.material.uniforms.uniPackTexture.value = this.packArrtexture[0];
  this.material.uniforms.uniRotateTexture.value = this.rotateArrtexture[0];
  this.subMaterial.uniforms.uniProjTexture.value = this.projArrtexture[1];
  this.subMaterial.uniforms.uniPackTexture.value = this.packArrtexture[1];
  this.subMaterial.uniforms.uniRotateTexture.value = this.rotateArrtexture[1];
}

Renderer.prototype.subMatchTracktoCube = function (track) {
  
  this.projArrtextureData[1].set(this.arrProjRegions[track]);
  this.packArrtextureData[1].set(this.arrPackedRegions[track]);
  this.rotateArrtextureData[1].set(this.arrRotates[track]);
  this.projArrtexture[1].needsUpdate = true;
  this.packArrtexture[1].needsUpdate = true;
  this.rotateArrtexture[1].needsUpdate = true;
}

Renderer.prototype.matchTracktoCube = function (track) {
  
  this.projArrtextureData[0].set(this.arrProjRegions[track]);
  this.packArrtextureData[0].set(this.arrPackedRegions[track]);
  this.rotateArrtextureData[0].set(this.arrRotates[track]);
  this.projArrtexture[0].needsUpdate = true;
  this.packArrtexture[0].needsUpdate = true;
  this.rotateArrtexture[0].needsUpdate = true;
  
}

Renderer.prototype.readyToChangeTrack = function (isSub) {
  this.isSub = isSub;
}

Renderer.prototype.animate = function () {
  var self = this;
  if(this.renderDebug){ 
    this.stats.begin();
    this.renderVideo();
    this.stats.end(); 
  } else{
    this.renderVideo();
  }
  this.aniReq = window.webkitRequestAnimationFrame(function () { self.animate(); });
}

Renderer.prototype.mainRenderVideo = function () {
  this.webGLRenderer.clear();
  this.webGLRenderer.render(this.subScene, this.camera);
}


Renderer.prototype.subRenderVideo = function () {
  this.subWebGLRenderer.clear();
  this.subWebGLRenderer.render(this.subScene, this.camera);
}


Renderer.prototype.renderVideo = function () {
  if(this.isAniPause){
    return;
  }
  this.controls.update();
  if(this.setIsSwitch){
    if(!this.isSub){
      if(this.videoElement.currentTime > this.maxCurTime){
        this.onSwitchRender(true);
      }
    } else{
      if(this.subVideoElement.currentTime > this.maxCurTime){
        //Log.warn("Renderer", "maxCurTime: "+ this.maxCurTime);
        //Log.warn("Renderer", "sub: "+ this.subVideoElement.currentTime);
        this.onSwitchRender(false);
      }
    }
  }
  
  this.webGLRenderer.clear();
  this.webGLRenderer.render(this.scene, this.camera);

  this.subWebGLRenderer.clear();
  this.subWebGLRenderer.render(this.subScene, this.camera);
  
  if(this.renderDebug){
    this.webGLRenderer.autoClear = false;
    this.webGLRenderer.clearDepth(); // clear the depth buffer
    this.webGLRenderer.render( this.debugScene, this.camera );

    this.subWebGLRenderer.autoClear = false;
    this.subWebGLRenderer.clearDepth(); // clear the depth buffer
    this.subWebGLRenderer.render( this.debugScene, this.camera );
  }
}

Renderer.prototype.getOMAFPosition = function() {
  var phi = this.controls.getAzimuthalAngle();
  var theta = this.controls.getPolarAngle() - Math.PI/2;
  return {"phi": phi, "theta": theta};
  // we don't need the rotation since the packing already does it correctly
  // var vec = new THREE.Vector3( Math.cos(theta)*Math.cos(phi), Math.cos(theta)*Math.sin(phi), Math.sin(theta) );  
  // var rotMatrix = new THREE.Matrix3();
  // rotMatrix.set(0, 1, 0,
  //               0, 0, 1,
  //               1, 0, 0);
  // vec.applyMatrix3(rotMatrix);
}

Renderer.prototype.resize = function (element, callback) {
  var height = $(element).height();
  var width  = $(element).width();
  
  return setInterval(function() {
      if ($(element).height() != height || $(element).width() != width) {
        height = $(element).height();
        width  = $(element).width();
        callback();
      }
  }, 300);
}

Renderer.prototype.setIsAniPause = function (isPause) {
  this.isAniPause = isPause;
}

Renderer.prototype.setMaxCurTime = function (time) {
  this.maxCurTime = time;
}

Renderer.prototype.setSwitch = function (isset) {
  this.setIsSwitch = isset;
}

Renderer.prototype.reset = function () {
  if(this.initialized){
    window.cancelAnimationFrame(this.aniReq);
    window.clearInterval(this.resizeReq);
    this.webGLRenderer.clear();
    this.subWebGLRenderer.clear();
    delete this.camera;
    delete this.scene;
    delete this.subScene;
    delete this.webGLRenderer;
    delete this.subWebGLRenderer;
    delete this.videoElement;
    delete this.subVideoElement;
    delete this.videoTexture;
    delete this.subVideoTexture;
    delete this.mesh;
    delete this.subMesh;
    delete this.effect;
    delete this.geometry;
    delete this.subGeometry;
    delete this.controls;
    delete this.allTracksRwpk;
    delete this.initialized;
    delete this.isSub;
    delete this.isAniPause;
    delete this.maxCurTime;
    delete this.setIsSwitch;
    delete this.aniReq;
    delete this.resizeReq;
    delete this.onInit;
    delete this.onSwitchRender;
  }
}