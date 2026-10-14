const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
function pdfFixture(){
 const text='BT /F1 18 Tf 20 240 Td (What is photosynthesis?) Tj ET';
 const second='BT /F1 18 Tf 20 240 Td (Explain chlorophyll.) Tj ET';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',`<< /Length ${text.length} >>\nstream\n${text}\nendstream`,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',`<< /Length ${second.length} >>\nstream\n${second}\nendstream`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 let result='%PDF-1.4\n',offsets=[];objects.forEach((object,i)=>{offsets.push(Buffer.byteLength(result));result+=`${i+1} 0 obj\n${object}\nendobj\n`});const start=Buffer.byteLength(result);result+=`xref\n0 8\n0000000000 65535 f \n${offsets.map(n=>String(n).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;return Buffer.from(result);
}
const server=http.createServer((req,res)=>{
 const filename=path.resolve(process.cwd(),'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
 if(!filename.startsWith(process.cwd()+path.sep)){res.writeHead(403);res.end();return;}
 try{const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml','.ftl':'text/plain'};res.writeHead(200,{'Content-Type':mime[path.extname(filename)]||'application/octet-stream'});res.end(fs.readFileSync(filename));}catch{res.writeHead(404);res.end();}
});
(async()=>{let browser;try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>route.request().url().startsWith(origin)||/^(blob:|data:)/.test(route.request().url())?route.continue():route.abort());
 await page.goto(origin+'/index.html');await page.click('#tab-papers');
 await page.setInputFiles('#practice-file',{name:'biology.pdf',mimeType:'application/pdf',buffer:pdfFixture()});
 await page.waitForFunction(()=>!document.querySelector('#paper-ai').disabled,{timeout:10000}).catch(async(error)=>{console.log('PDF status:',await page.locator('#pdf-error').textContent());console.log('Runtime errors:',errors);throw error;});
 await page.locator('#pdf-viewer').scrollIntoViewIfNeeded();
 const frame=page.frameLocator('#pdf-viewer');
 console.log('viewer opened; child frames:',page.frames().map(f=>f.url()).filter(u=>u.includes('viewer.html')));
 const initialChild=page.frames().find(f=>f.url().includes('viewer.html'));
 console.log('viewer DOM:',await initialChild.evaluate(()=>({pages:document.querySelectorAll('.page').length,textLayers:document.querySelectorAll('.textLayer').length,spans:document.querySelectorAll('.textLayer span').length,canvas:document.querySelectorAll('canvas').length,loaded:!!PDFViewerApplication.pdfDocument}))); 
 await frame.locator('.textLayer span').first().waitFor();
 assert.ok((await frame.locator('.textLayer').first().innerText()).includes('photosynthesis'));
 await frame.locator('#editorFreeTextButton').click();
 await frame.locator('.page').first().click({position:{x:180,y:150}});
 const editor=frame.locator('.freeTextEditor [contenteditable="true"]').first();await editor.waitFor();await editor.fill('My revision note');
 await page.click('#paper-save-edits');await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('annotations saved'));
 console.log('Saved edits; attaching page');
 await page.click('#paper-ai');await page.waitForFunction(()=>!document.querySelector('#ai-context-preview').hidden);
 assert.ok((await page.locator('#ai-context-image').getAttribute('src')).startsWith('data:image/jpeg'));
 await page.click('#close-chatbot');
 await frame.locator('#next').click();
 await frame.locator('#pageNumber').evaluate(input=>{if(input.value!=='2')throw Error('wrong page')});
 await page.click('#paper-ai');await page.waitForFunction(()=>document.querySelector('#ai-context-title').textContent.includes('page 2'));
 assert.match(await page.locator('#ai-context-text').textContent(),/chlorophyll/);
 console.log('Second-page attachment passed; reloading');
 await page.reload();await page.click('#tab-papers');await page.waitForFunction(()=>!document.querySelector('#paper-ai').disabled,{timeout:10000}).catch(async(error)=>{console.log('PDF status:',await page.locator('#pdf-error').textContent());console.log('Runtime errors:',errors);throw error;});
 const child=page.frames().find(f=>f.url().includes('/viewer.html'));
 const annotations=await child.evaluate(async()=> (await PDFViewerApplication.pdfDocument.getPage(1)).getAnnotations());
 assert.ok(annotations.some(a=>a.subtype==='FreeText' && a.contentsObj?.str==='My revision note'));
 console.log('Saved annotation reload passed; opening notes');
 await page.click('#tab-notes');await page.setInputFiles('#notes-file',{name:'notes.pdf',mimeType:'application/pdf',buffer:pdfFixture()});await page.fill('#notes-subject','Biology');await page.click('#notes-save');
 await page.waitForFunction(()=>!document.querySelector('#note-ai').disabled,{timeout:10000});
 await page.click('#note-ai');await page.waitForFunction(()=>document.querySelector('#ai-context-title').textContent.includes('notes.pdf'));
 assert.ok((await page.locator('#ai-context-image').getAttribute('src')).startsWith('data:image/jpeg'));
 await page.click('#close-chatbot');await page.screenshot({path:'/tmp/study-full-pdf.png',fullPage:true});
 assert.deepEqual(errors,[]);
 console.log('HTTP workflows passed; testing local-file opening');
 const local=await browser.newPage();await local.route('**/*',route=>/^(file:|blob:|data:)/.test(route.request().url())?route.continue():route.abort());
 await local.goto('file://'+path.resolve('index.html'));await local.click('#tab-papers');await local.setInputFiles('#practice-file',{name:'local.pdf',mimeType:'application/pdf',buffer:pdfFixture()});await local.waitForFunction(()=>!document.querySelector('#paper-ai').disabled,{timeout:10000});await local.click('#paper-ai');await local.waitForFunction(()=>!document.querySelector('#ai-context-preview').hidden);
 console.log('PASS: full viewer, text layer, free-text annotation, saved edit after reload, current-page AI images/text, notes viewer, and direct file opening. No live AI requests.');
}finally{await browser?.close();await new Promise(r=>server.close(r));}})().catch(error=>{console.error(error.stack);process.exitCode=1});
