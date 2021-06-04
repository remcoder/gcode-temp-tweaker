<script>
	import Dropzone from "svelte-file-dropzone";
	import * as GCodePreview from "gcode-preview";
	export let name;

  
	let files = {
	  accepted: [],
	  rejected: []
	};

  let layers = [];
  
	async function handleFilesSelect(e) {
	  const { acceptedFiles, fileRejections } = e.detail;
	  files.accepted = [...files.accepted, ...acceptedFiles];
	  files.rejected = [...files.rejected, ...fileRejections];

	  // const gcode = 'G0 X0 Y0 Z0.2\nG1 X42 Y42'; // draw a diagonal line
	  const preview = new GCodePreview.WebGLPreview({
			targetId: 'gcode-preview',
		});
		
    const file = files.accepted[0];
    const gcode = await file.text();
		preview.processGCode(gcode);
		//preview.render();
    window.preview = preview;
    analyseFlow(preview);
	}

  const cur = { x: 0, y: 0, z: 0, e: 0, f:0 };

  // for now we only look at the feed rate
  function analyseFlow(preview) {
    console.log(preview.layers);
    for (const layer of preview.layers) {
      const res = analyzeLayer(layer.commands)
      layers.push(res);
    }
    layers = layers;
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

    const flow = totalE / totalT;

    return {
      totalE,
      totalT,
      flow
    };
  }

  function doMove(cur, next) {
    const dx = next.x - cur.x;
    const dy = next.y - cur.y;
    const d = Math.sqrt(dx*dx + dy*dy);
    const f = (cur.f + next.f) / 2; // feedrate
    const dt = d / f;
    const de = next.e;
    
    return {
      dt,
      de
    }
  }

  // we should only have move commands, being g0 or g1
  // function analyzeCommands(commands) {
  //   // for now assume: absolute positioning for X/Y, relative distances for extrusion
  //   let totalX = 0, totalY = 0, totalE = 0;
  //   let prevX = 0;
  //   let prevCmd;
  //   let totalF = 0, countF = 0;
  //   let curF = 0;
  //   for (const cmd of commands) {
      
  //     if ('e' in cmd.params) {
  //       totalE += cmd.params.e;
  //     }
  //     // if (prevCmd) {
  //     //   totalX += cmd.x - prevCmd.x;
  //     //   totalY += cmd.y - prevCmd.y;
  //     //}

  //     // prevCmd = cmd;

  //     if ('f' in cmd.params) {
  //       totalF += cmd.params.f;
  //       countF++;
  //     }


  //   }

  //   const avgF = totalF / countF;

  //   console.log('total', totalX, totalY, totalE, avgF);
  //   return {
  //     totalE,
  //     avgF
  //   };
  // }
</script>	

<main>
	<h1>GCode Temp Tweaker</h1>
	
  <Dropzone on:drop={handleFilesSelect} />

  <div id="gcode-preview"></div>

	<ol>
	{#each layers as layer}
		<li>{Math.round(layer.totalE)}mm {Math.round(layer.totalT*60)}s {Math.round(layer.flow)}mm/min  </li>
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