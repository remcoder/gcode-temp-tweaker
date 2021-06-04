<script>
	import Dropzone from "svelte-file-dropzone";
	import * as GCodePreview from "gcode-preview";
	export let name;

  const nozzleDia = 0.4
  const nozzleRadius = nozzleDia / 2;
  const nozzleArea = nozzleRadius * nozzleRadius * Math.PI;
  
	let files = {
	  accepted: [],
	  rejected: []
	};

  // analysis output
  let layers = [];
  let time = 0;
  let extruded = 0;
  let volume = 0;
  const cur = { x: 0, y: 0, z: 0, e: 0, f:0 };
  init();

  async function init() {
    const response = await fetch('double-cylinder.gcode');

    if (response.status !== 200) {
      console.error('ERROR. Status Code: ' + response.status);
      return;
    }

    const gcode = await response.text();
    handleGCode(gcode);
  }

	async function handleFilesSelect(e) {
	  const { acceptedFiles, fileRejections } = e.detail;
	  files.accepted = [...files.accepted, ...acceptedFiles];
	  files.rejected = [...files.rejected, ...fileRejections];

    const file = files.accepted[0];
    const gcode = await file.text();
    
    handleGCode(gcode);
	}

  function handleGCode(gcode) {
    const preview = new GCodePreview.WebGLPreview({
			targetId: 'gcode-preview',
		});
    
		preview.processGCode(gcode);
		//preview.render();
    window.preview = preview;
    layers = analyseFlow(preview);

    time = layers.reduce((prev, cur) => prev + cur.totalT, 0);
    extruded = layers.reduce((prev, cur) => prev + cur.totalE, 0);
    volume = layers.reduce((prev, cur) => prev + cur.totalE*nozzleArea, 0);
  }
  
  // for now we only look at the feed rate
  function analyseFlow(preview) {
    console.log(preview.layers);

    return preview.layers.map( l => analyzeLayer(l.commands) );
  }

  function analyzeLayer(commands) {
    console.log(commands);
    let totalE = 0, totalT = 0;

    for (const cmd of commands) {
      const g = cmd;

      const next = {
        x: g.params.x !== undefined ? g.params.x : cur.x,
        y: g.params.y !== undefined ? g.params.y : cur.y,
        z: g.params.z !== undefined ? g.params.z : cur.z,
        e: g.params.e !== undefined ? g.params.e : cur.e,
        f: g.params.f !== undefined ? g.params.f : cur.f,
      };
      
      const {dt, de } = doMove(cur, next);
      totalE += de;
      
      if (!isNaN(dt))
        totalT += dt;

      // update cur
      if (g.params.x) cur.x = g.params.x;
      if (g.params.y) cur.y = g.params.y;
      if (g.params.z) cur.z = g.params.z;
      if (g.params.e) cur.e = g.params.e;
      if (g.params.f) cur.f = g.params.f;
    }

    // mm/s
    const flow = totalE / (totalT);
    
    // mm^3/s
    const vol = flow * nozzleArea;
    return {
      totalE,
      totalT,
      flow,
      vol
    };
  }

  function doMove(cur, next) {
    const dx = next.x - cur.x;
    const dy = next.y - cur.y;
    const d = Math.sqrt(dx*dx + dy*dy);
    const f = (cur.f + next.f) / 2; // feedrate
    const fs = f * 60; // feedrate in seconds
    const dt = d / (fs);
    const de = next.e * 0.95; // NOTE: based on M221 command found in gcode file
    
    return {
      dt,
      de
    }
  }

</script>	

<main>
	<h1>GCode Temp Tweaker</h1>
	
  <Dropzone on:drop={handleFilesSelect} />

  <div id="gcode-preview"></div>

  <div> total time:  {time}min</div>
  <div> total extruded:  {Math.round(extruded)}mm</div>
  <!-- <div> total volume:  {Math.round(volume)}mm^3</div> -->
	<ol>
	{#each layers as layer}
		<li>{Math.round(layer.totalE)}mm {Math.round(layer.totalT)}s {Math.round(layer.flow)}mm/min 
      <!-- {layer.vol.toFixed(3) }mm^3/s   -->
      </li>
	{/each}
	</ol>
</main>

<style>
	main {
		text-align: center;
		padding: 1em;
		max-width: 240px;
		margin: 0 auto;
	}

	h1 {
		color: #ff3e00;
		text-transform: uppercase;
		font-size: 4em;
		font-weight: 100;
	}

	@media (min-width: 640px) {
		main {
			max-width: none;
		}
	}
</style>