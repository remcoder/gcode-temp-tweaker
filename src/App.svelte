<script>
  import { onMount } from 'svelte';
	// import Dropzone from "svelte-file-dropzone";
	import * as GCodePreview from "gcode-preview";
  import * as FileSaver from 'file-saver';

  let file;
  let showDropZone = true;
  let canvasElement;
  let filamentDia = 1.75;
  let filamentRadius, filamentCrossSection = 1;
  let showAllLayers = false;
  
	let files = {
	  accepted: [],
	  rejected: []
	};
  
  // gcode processor state
  const cur = { x: 0, y: 0, z: 0, e: 0, f:1, relativeE: false };

  // analysis output, reactive
  let time = 0;
  let extruded = 0;
  let volume = 0;
  let minExtrusionSpeed = 0;
  let maxExtrusionSpeed = 0;
  let minFlow = 0;
  let maxFlow = 0;
  let minTemp = 200;
  let maxTemp = 230;
  let tempInc = 5;
  // let flowVsTemp = [];
  let gcodePreview;
  let tempChanges = [];
  let analyzedLayers = [];
  let skipFirstLayers = 0;
  let skipLastLayers = 0;

  $: analyzedLayers  = analyzeGCode(gcodePreview, filamentDia);
  $: ({
      time,
      extruded,
      volume,
      minExtrusionSpeed,
      maxExtrusionSpeed,
      minFlow,
      maxFlow } = aggregateLayerStats(analyzedLayers, skipFirstLayers, skipLastLayers));
  $: tempChanges = generateTempChanges(analyzedLayers, minFlow, maxFlow, minTemp, maxTemp, tempInc, skipFirstLayers, skipLastLayers);
  
  // init()

  onMount(() => {
    canvasElement.addEventListener('dragover', function(evt) {
        evt.stopPropagation();
        evt.preventDefault();
        evt.dataTransfer.dropEffect = 'copy';
        // document.body.className = "dragging";
    });

    canvasElement.addEventListener('dragleave', function(evt) {
        evt.stopPropagation();
        evt.preventDefault();
        // document.body.className = "";
    });

    canvasElement.addEventListener('drop', function(evt) {
        evt.stopPropagation();
        evt.preventDefault();
        // document.body.className = "";
        const reader = new FileReader();
        reader.onload = function() {
          handleGCode(reader.result);
        };
        reader.readAsText(evt.dataTransfer.files[0]);
      });
  });

  async function init() {
    const response = await fetch('double-cylinder.gcode');

    if (response.status !== 200) {
      console.error('ERROR. Status Code: ' + response.status);
      return;
    }

    const gcode = await response.text();
    return handleGCode(gcode);
  }

	async function handleFilesSelect(e) {
	  const { acceptedFiles, fileRejections } = e.detail;
	  files.accepted = [...files.accepted, ...acceptedFiles];
	  files.rejected = [...files.rejected, ...fileRejections];

    file = files.accepted[0];
    const gcode = await file.text();
    showDropZone = false;
    
    handleGCode(gcode);
	}

  function handleGCode(gcode) {
    const preview = new GCodePreview.WebGLPreview({
			canvas: canvasElement 
		});
    // preview.renderTravel = true;
    
		preview.processGCode(gcode);
    gcodePreview = window.__preview__ = preview;
    return preview;
  }
  
  // for now we only look at the feed rate
  function analyzeGCode(preview, filamentDia  ) {
    console.debug('analyze gcode' , filamentDia);
    // console.log(preview.layers);
    if (!preview)
      return [];
    
    filamentRadius = filamentDia / 2;
    filamentCrossSection = filamentRadius * filamentRadius * Math.PI;

    const mappedLayer = [preview.parser.preamble, ...preview.layers]
      .map( l => analyzeLayer(l) );
    return mappedLayer.slice(1);
  }

  function analyzeLayer(layer) {
    let totalE = 0, 
    totalT = 0, 
    firstExtrusionDone = false,
    z;

    for (const cmd of layer.commands) {
      if (cmd.gcode == 'm83') { // E Relative
        cur.relativeE = true;
        console.log('relativeE', cur.relativeE);
        continue;
      }
      
      if (cmd.gcode == 'm82') { // E Absolute
        cur.relativeE = false;
        console.log('relativeE', cur.relativeE);
        continue;
      }

      if (cmd.gcode == 'g92') { // Set Position
        if ('x' in cmd.params) cur.x = cmd.params.x;
        if ('y' in cmd.params) cur.y = cmd.params.y;
        if ('z' in cmd.params) cur.z = cmd.params.z;
        if ('e' in cmd.params) cur.e = cmd.params.e;
        continue;
      }

      if ( cmd.gcode != 'g0' && cmd.gcode != 'g1' ) {
        continue;
      }

      const next = {
        x: 'x' in cmd.params ? cmd.params.x : cur.x,
        y: 'y' in cmd.params ? cmd.params.y : cur.y,
        z: 'z' in cmd.params ? cmd.params.z : cur.z,
        e: 'e' in cmd.params ? cmd.params.e : cur.e,
        f: 'f' in cmd.params ? cmd.params.f : cur.f,
      };
      
      // do move
      const dx = next.x - cur.x;
      const dy = next.y - cur.y;
      const d = Math.sqrt(dx*dx + dy*dy);
      const f = next.f;
      const fs = f / 60; // feedrate in seconds
      const dt = d / fs; // fs = d / t
      const de = cur.relativeE ? next.e : next.e - cur.e; // * 0.95; // NOTE: based on M221 command for MINI ONLY
      
      if (!firstExtrusionDone && de > 0) { // ignores (de)retractions
        z = next.z; // assume abs pos
        firstExtrusionDone = true;
      }
      totalE += de;
      if (!isNaN(dt))
        totalT += dt;

      // update cur 
      // FIXME: should be: cur = next (or similar)
      if (cmd.params.x) cur.x = cmd.params.x;
      if (cmd.params.y) cur.y = cmd.params.y;
      if (cmd.params.z) cur.z = cmd.params.z;
      if (cmd.params.e) cur.e = cmd.params.e;
      if (cmd.params.f) cur.f = cmd.params.f;
    }


    // mm/s
    const flow = totalE / totalT;
    
    // mm^3/s
    const vol = flow * filamentCrossSection;
    return {
      z,
      lineNumber: layer.lineNumber,
      totalE,
      totalT,
      flow,
      vol
    };
  }

  function aggregateLayerStats(layers) {
    console.debug('aggregateLayerStats');

    const time = layers.reduce((prev, cur) => prev + cur.totalT, 0);
    const extruded = layers.reduce((prev, cur) => prev + cur.totalE, 0);
    const volume = layers.reduce((prev, cur) => prev + cur.totalE*filamentCrossSection, 0);

    const minExtrusionSpeed = layers.reduce((prev, cur)=> Math.min(prev , cur.flow), Infinity );
    const maxExtrusionSpeed = layers.reduce((prev, cur)=> Math.max(prev , cur.flow), -Infinity );

    const minFlow = minExtrusionSpeed * filamentCrossSection;
    const maxFlow = maxExtrusionSpeed * filamentCrossSection;
    return {
      time,
      extruded,
      volume,
      minExtrusionSpeed,
      maxExtrusionSpeed,
      minFlow,
      maxFlow
    };
  }

  function generateTempChanges(layers, minFlow, maxFlow, minTemp, maxTemp, tempInc, skipFirstLayers, skipLastLayers) {
    console.debug('generateTempChanges', minFlow, maxFlow, minTemp, maxTemp, tempInc, skipFirstLayers, skipLastLayers);
    // NOTE: assumption: first layer == slowest == minTemp
    const changes = {};
    let prevTemp = minTemp;

    for (let i = 0; i < layers.length; i++) {
      if (i < skipFirstLayers) continue;
      if (i >= (layers.length - 1 - skipLastLayers) ) break;
      const layer = layers[i];
      const desiredTemp = roundTo(interpolateTemp(layer.vol, minFlow, maxFlow, minTemp, maxTemp), tempInc);
      
      if (desiredTemp != prevTemp) {
        const change = {
          layerNumber: i+1,
          layer,
          temp: desiredTemp
        };
        changes[i] = change;
      }

      prevTemp = desiredTemp;
    }

    return changes;
  }

  // linear transformation
  function interpolateTemp(flow, minFlow, maxFlow, minTemp, maxTemp) {
    const dFlow = maxFlow - minFlow;
    const dTemp = maxTemp - minTemp;

    return minTemp + dTemp * ((flow - minFlow) / dFlow);
  }

  function roundTo(n, p) {
    return p * Math.floor(n / p);
  }

  function saveTargetFile() {
    const lines = gcodePreview.parser.lines.slice();
    const layersWithChanges = Object.keys(tempChanges);

    layersWithChanges.reverse();
    layersWithChanges.forEach(index => lines.splice(tempChanges[index].layer.lineNumber,0, `M104 S${tempChanges[index].temp} ; injected by GCode Temp Tweaker` ) );

    const gcode = lines.join('\n');

    var blob = new Blob([gcode], {type: "text/plain;charset=utf-8"});
    FileSaver.saveAs(blob, "hello world.gcode");
  }

  function isLayerExcluded(layerIndex) {
    // console.log(layerIndex, skipFirstLayers, layerIndex < skipFirstLayers);
    return layerIndex < skipFirstLayers || layerIndex > (analyzedLayers.length -1 - skipLastLayers);
  }

</script>	

<main>
	<h1>GCode Temp Tweaker</h1>
	
  <div class="columns">
  <section> 
    <h2>1. Drag n drop gcode file</h2>

    <div class="preview-wrapper">
      
      <!-- {#if !file}
          <button>Choose images to upload</button>

          <p>or</p>
          <p>Drag and drop them here</p>
        
      {/if} -->

      {#if file}
      
        <div class="summary">
          <h4>{file.name}</h4>
          {#if analyzedLayers.length}
          <table>

          </table>
          <tr><td># of layers</td><td>{analyzedLayers.length} </td></tr>
          <tr><td>total time</td><td>{Math.round(time/60)}min</td></tr>
          <tr><td>total extruded</td><td>{Math.round(extruded)}mm</td></tr>
          <tr><td>total volume</td><td>{Math.round(volume)}mm^3</td></tr>
          <tr><td>min extr speed</td><td>{minExtrusionSpeed.toFixed(2)} </td></tr>
          <tr><td>max extr speed</td><td>{maxExtrusionSpeed.toFixed(2)} </td></tr>
          <tr><td>min flow rate</td><td>{minFlow.toFixed(2)} </td></tr>
          <tr><td>max flow rate</td><td>{maxFlow.toFixed(2)} </td></tr>
          {/if}
        </div>
      {/if}
      
      <canvas width=400 height=300 bind:this={canvasElement}></canvas>
      
    </div>

    <section>
      <h2>2. Set temp & flow rate</h2>
      <table>
        <tr><th></th><th>min</th><th>max</th></tr>
        <tr>
          <th><label for="minFlow">extr speed (mm/s)</label></th>
          <td><output>{minExtrusionSpeed.toFixed(2)}</output></td>
          <td><output>{maxExtrusionSpeed.toFixed(2)}</output></td>
        </tr>
        <tr>
          <th><label for="minFlow">vol. flow (mm3/s)</label></th>
          <td><output>{minFlow.toFixed(2)}</output></td>
          <td><output>{maxFlow.toFixed(2)}</output></td>
        </tr>
        <tr>
          <th><label for="minTemp">temp (C)</label></th>
          <td><input type="number" name="minTemp" bind:value={minTemp} /></td>
          <td><input type="number" name="maxTemp" bind:value={maxTemp} /></td>
        </tr>
        <tr>
          <th><label for="tempInc">temp step size</label></th>
          <td><input type="number" name="tempInc" bind:value={tempInc} min="1" /></td>
        </tr>
        <tr>
          <th><label for="filemantDia">filament diameter</label></th>
          <td>
            <select name="filamentDia" bind:value={filamentDia}> 
              <option value="1.75">1.75mm</option>
              <option value="2.85">2.85mm</option>
            </select>
          </td>
        </tr>
        <tr>
          <th><label for=skipFirstLayers>ignore first X layers</label></th>
          <td><input type=number bind:value={skipFirstLayers} name=skipFirstLayers min=0 /></td>
        </tr>
        <tr>
          <th><label for=skipLastLayers>ignore last X layers</label></th>
          <td><input type=number bind:value={skipLastLayers} name=skipLastLayers min=0 /></td>
        </tr>
      </table>
    </section>
  </section>
 
  <section>
    {#if analyzedLayers.length}
      <h2>3. Download new file</h2>
      <p>The resulting file contains newly inserted temperature commands (M104). example:</p>
      <pre><code>M104 S215</code></pre>
      <button disabled={!Object.keys(tempChanges).length} on:click={saveTargetFile}>download file ↓</button>
      <h2>Temp changes</h2>
      <div>
        show all layers <input type="checkbox" bind:checked={showAllLayers} />
      </div>

      <table>
        <tr>
          <th>layer</th>
          <th>z (mm)</th>
          <th>line</th>
          <th>extrusion (mm)</th>
          <th>time (s)</th>
          <th>extr speed (mm/s)</th>
          <th>flow rate (mm^3/s)</th>
          <th>temp (C)</th>
        </tr>
        {#each analyzedLayers as layer, index}
          {#if tempChanges[index] || showAllLayers}
          
            <tr class:subtle={!tempChanges[index]} class:excludedLayer={isLayerExcluded(index, skipFirstLayers, skipLastLayers)} >
              <td>{index +1}</td>
              <td>{layer.z}</td>
              <td>{layer.lineNumber}</td>
              <td>{Math.round(layer.totalE)}</td>
              <td>{Math.round(layer.totalT)}</td>
              <td>{layer.flow.toFixed(2)}</td>
              <td>{layer.vol.toFixed(3) }</td>
              <td class="primary">{tempChanges[index] ? tempChanges[index].temp : '' }</td>
            </tr>
          {/if}
        {/each} 
      </table>
    {/if}
  </section>

  

  
</div>
</main>

<style>
	main {
		text-align: left;
    color: #d2d2d2;
    font-size: 110%;;
	}

	h1 {
		color: #ff5900;
		text-transform: uppercase;
		font-size: 4em;
		font-weight: 200;
    margin: 0;
	}

  h2 {
    color: #ff5900;
    text-transform: uppercase;
    font-weight: 200;
  }
  section {
    margin: 5px;
  }
  .columns {
    display: flex;
  }
  input[type=number] {
    width: 100px;
  }

  output {
    color: #ff5900;
  }
  pre {
    padding: 10px;
    background: #4c4c4c;
  }

  .preview-wrapper {
    display: inline-block;
  }
  
  canvas {
    border: 1px solid grey;
    width: 600px;
    height: 300px;
    box-sizing: border-box;
  }
  canvas:focus {
    outline: none;
  }

  .summary {
    display: none;
    position: absolute;
    text-align: left;
    color: yellow;
    background-color: rgba(0,0,0,0.5);
    padding: 5px;
    font-size: 90%;
  }

  .primary {
    color: #ff5900;
  }

  .subtle {
    color: grey;
  }

  .excludedLayer {
    text-decoration: line-through;
  }

  button {
    color: #fff;
    background-color: #ff5900;
  }
  [disabled] {
    opacity: 0.5;
  }
</style>
