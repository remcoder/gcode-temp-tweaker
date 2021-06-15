<script>
	import Dropzone from "svelte-file-dropzone";
	import * as GCodePreview from "gcode-preview";
  import * as FileSaver from 'file-saver';

	export let name;

  let file = {};
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
    
    handleGCode(gcode);
    showDropZone = false;
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
    let totalE = 0, totalT = 0;

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

    minFlow = layers.reduce((prev, cur)=> Math.min(prev , cur.flow), Infinity );
    maxFlow = layers.reduce((prev, cur)=> Math.max(prev , cur.flow), -Infinity );

    return {
      time,
      extruded,
      volume,
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
          layer: i+1,
          lineNumber: layer.lineNumber,
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
    tempChanges.forEach(ch=> lines.splice(ch.lineNumber,0, `M104 S${ch.temp} ; injected by GCode Temp Tweaker` ) );
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
    <h2>Preview</h2>
    {#if showDropZone}
      <Dropzone   on:drop={handleFilesSelect}>
        <button>Choose images to upload</button>

        <p>or</p>
        <p>Drag and drop them here</p>
      </Dropzone>

    {/if}

    <canvas bind:this={canvasElement}></canvas>
    <div>{file.name}</div>
    <div>filament diameter <select bind:value={filamentDia}> 
        <option value="1.75">1.75mm</option>
        <option value="2.85">2.85mm</option>
      </select>
    </div>
    <div> total time:  {Math.round(time/60)}min</div>
    <div> total extruded:  {Math.round(extruded)}mm</div>
    <div> total volume:  {Math.round(volume)}mm^3</div>
    <div> minimum flow rate {minFlow.toFixed(2)} </div>
    <div> maximum flow rate {maxFlow.toFixed(2)} </div>
    <div> # of layers {analyzedLayers.length} </div>

    <ol>
      {#each analyzedLayers as layer}
        <li>
          #{layer.lineNumber}
          {Math.round(layer.totalE)}mm 
          {Math.round(layer.totalT)}s 
          {layer.flow.toFixed(2)}mm/s 
          {layer.vol.toFixed(3) }mm^3/s  
        </li>
      {/each} 
    </ol>
  </section>
  <section>
    <h2>Target flow & temps</h2>
    <div class="column-wrapper">
      <div class="column">
        <label for="minFlow">min flow</label>
        <output>{minFlow.toFixed(2)}</output>
        <label for="minTemp">min temp</label><input type="number" name="minTemp" bind:value={minTemp} />
      </div>

      <div class="column">
        <label for="maxFlow">max flow</label>
        <output>{maxFlow.toFixed(2)}</output>
        <label for="maxTemp">max temp</label><input type="number" name="maxTemp" bind:value={maxTemp} />
      </div>
    </div>
    <label for="tempInc">temp step size</label><input type="number" name="tempInc" bind:value={tempInc} />

    <h3>Temp changes</h3>
    <button on:click={saveTargetFile}>save file</button>
    {#each tempChanges as change}
      <div>{change.layer} #{change.lineNumber} {change.temp}C <pre><code>M104 S{change.temp}</code></pre> </div>
    {/each}
  </section>
</div>
</main>

<style>
	main {
		text-align: center;
		/* padding: 1em; */
		max-width: 240px;
		margin: 0 auto;
	}

	h1 {
		color: #ff5900;
		text-transform: uppercase;
		font-size: 4em;
		font-weight: 200;
	}

  .wrapper {
    display: flex;
    background-color: rgba(0,0,0,0.5);
    color: white;
    font-size: 110%;;
  }

  .wrapper section {
    width: 50vw;
  }

  .column-wrapper {
    display: flex;
    justify-content: space-around;
  }

  pre {
    display: inline-block;
  }

  .dropzone {
    color:white;
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
</style>