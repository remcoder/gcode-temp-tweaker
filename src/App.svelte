<script>
	import Dropzone from "svelte-file-dropzone";
	import * as GCodePreview from "gcode-preview";
  import * as FileSaver from 'file-saver';

  let file;
  let showDropZone = true;
  let canvasElement;
  let filamentDia = 1.75;
  let filamentRadius, filamentCrossSection;
  
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
  let tempInc = 1;
  // let flowVsTemp = [];
  let gcodePreview;
  let tempChanges = [];
  let analyzedLayers = [];

  $: analyzedLayers  = analyzeGCode(gcodePreview, filamentDia);
  $: ({
      time,
      extruded,
      volume,
      minFlow,
      maxFlow } = aggregateLayerStats(analyzedLayers));
  $: tempChanges = generateTempChanges(analyzedLayers, minFlow, maxFlow, minTemp, maxTemp, tempInc);

  //init()

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

    time = layers.reduce((prev, cur) => prev + cur.totalT, 0);
    extruded = layers.reduce((prev, cur) => prev + cur.totalE, 0);
    volume = layers.reduce((prev, cur) => prev + cur.totalE*filamentCrossSection, 0);

    minExtrusionSpeed = layers.reduce((prev, cur)=> Math.min(prev , cur.flow), Infinity );
    maxExtrusionSpeed = layers.reduce((prev, cur)=> Math.max(prev , cur.flow), -Infinity );

    minFlow = minExtrusionSpeed * filamentCrossSection;
    maxFlow = maxExtrusionSpeed * filamentCrossSection;
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

  function generateTempChanges(layers, minFlow, maxFlow, minTemp, maxTemp, tempInc) {
    console.debug('generateTempChanges');
    // NOTE: assumption: first layer == slowest == minTemp
    const changes = [];
    let prevTemp = minTemp;

    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      const desiredTemp = roundTo(interpolateTemp(layer.flow, minFlow, maxFlow, minTemp, maxTemp), tempInc);
      
      if (desiredTemp != prevTemp) {
        changes.push({
          layerNumber: i+1,
          layer,
          temp: desiredTemp
        });
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
    
    tempChanges.reverse();
    tempChanges.forEach(ch=> lines.splice(ch.layer.lineNumber,0, `M104 S${ch.temp} ; injected by GCode Temp Tweaker` ) );
    tempChanges.reverse();

    const gcode = lines.join('\n');

    var blob = new Blob([gcode], {type: "text/plain;charset=utf-8"});
    FileSaver.saveAs(blob, "hello world.gcode");
  }

</script>	

<main>
	<h1>GCode Temp Tweaker</h1>
	
  <div class="wrapper">
  <section> 
    <h2>1. Specify gcode file</h2>

    <div class="preview-wrapper">
      {#if showDropZone}
        <Dropzone   on:drop={handleFilesSelect}>
          <button>Choose images to upload</button>

          <p>or</p>
          <p>Drag and drop them here</p>
        </Dropzone>
      {/if}

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
      
      <canvas bind:this={canvasElement}></canvas>

    </div>
    
    {#if analyzedLayers.length}
      <div>set filament diameter: <select bind:value={filamentDia}> 
          <option value="1.75">1.75mm</option>
          <option value="2.85">2.85mm</option>
        </select>
      </div>
      <table>
        <tr>
          <th>layer</th>
          <th>z</th>
          <th>line</th>
          <th>extrusion</th>
          <th>time</th>
          <th>extrusion speed</th>
          <th>vol. flow rate</th>
        </tr>
        {#each analyzedLayers as layer, index}
          <tr>
            <td>{index +1}</td>
            <td>{layer.z}</td>
            <td>{layer.lineNumber}</td>
            <td>{Math.round(layer.totalE)}mm</td>
            <td>{Math.round(layer.totalT)}s</td>
            <td>{layer.flow.toFixed(2)}mm/s</td>
            <td>{layer.vol.toFixed(3) }mm^3/s</td>
          </tr>
        {/each} 
      </table>
    {/if}
  </section>
  <section>
    <h2>2. Set flow & temps</h2>
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
    </table>
   
    <label for="tempInc">temp step size</label><input type="number" name="tempInc" bind:value={tempInc} min="1" />

    {#if tempChanges.length}
      <h2>3. Save updated gcode</h2>
      <p><button on:click={saveTargetFile}>download file ↓</button></p>
      <p>The following {tempChanges.length} temp changes will be injected into the gcode at the given lines.</p>
      <table>
        <tr>
          <th>layer</th>
          <th>z</th>
          <th>line</th>
          <th>temp (C)</th>
          <th>gcode</th>
        </tr>
        {#each tempChanges as change}
        <tr>
          <td>{change.layerNumber}</td>
          <td>{change.layer.z}</td>
          <td>{change.layer.lineNumber}</td>
          <td>{change.temp}°</td>
          <td><pre><code>M104 S{change.temp}</code></pre></td>
        </tr>
        {/each}
      </table>
    {/if}
  </section>
</div>
</main>

<style>
	main {
		text-align: left;
		/* padding: 1em; */
		max-width: 240px;
		margin: 0 auto;
	}

	h1 {
		color: #ff5900;
		text-transform: uppercase;
		font-size: 4em;
		font-weight: 200;
    margin: 0;
	}

  .wrapper {
    display: flex;
    xbackground-color: rgba(0,0,0,0.5);
    color: #d2d2d2;
    font-size: 110%;;
  }

  .wrapper section {
    width: 50vw;
  }
  pre {
    display: inline-block;
    margin: 0;
  }

	@media (min-width: 640px) {
		main {
			max-width: none;
		}
	}

  input[type=number] {
    width: 100px;
  }

  output {
    color: #ff5900;
  }

  .preview-wrapper {
    display: inline-block;
  }
  canvas:focus {
    outline: none;
  }

  .summary {
    position: absolute;
    text-align: left;
    color: yellow;
    background-color: rgba(0,0,0,0.5);
    padding: 5px;
    font-size: 90%;
  }

button {
  color: #fff;
  background-color: #ff5900;
}
</style>