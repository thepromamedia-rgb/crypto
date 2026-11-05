'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-admin-roles-'));
const port = 33000 + Math.floor(Math.random() * 10000);
const env = { ...process.env, PORT:String(port), HOST:'127.0.0.1', DATA_DIR:dir,
  ADMIN_EMAIL:'owner@example.test', ADMIN_PASSWORD:'OwnerPassword123!',
  JWT_SECRET:'role-test-secret-that-is-at-least-32-characters-long' };
const child = spawn(process.execPath, ['server.js'], { cwd:__dirname, env, stdio:'ignore' });
const base = `http://127.0.0.1:${port}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function request(route, {method='GET', body, cookie}={}) {
  const headers = {'X-Panel-Slug':'main'};
  if (body !== undefined) headers['Content-Type']='application/json';
  if (cookie) headers.Cookie=cookie;
  const res = await fetch(base+route,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const data = await res.json().catch(()=>({}));
  return {status:res.status,data,cookie:res.headers.get('set-cookie')};
}
async function login(email,password) {
  const r=await request('/api/login',{method:'POST',body:{email,password}});
  assert.equal(r.status,200,`login ${email}: ${JSON.stringify(r.data)}`);
  return r.cookie.split(';')[0];
}
(async()=>{
  try {
    let ready=false;
    for(let i=0;i<60;i++){try{if((await fetch(base+'/healthz')).ok){ready=true;break;}}catch{} await sleep(250);}
    assert.ok(ready,'server startup');
    const owner=await login('owner@example.test','OwnerPassword123!');
    for(const [role,email] of [['superAdmin','super@example.test'],['subAdmin','sub@example.test'],['supportAdmin','support@example.test']]){
      const r=await request('/api/admin/admins/manage',{method:'POST',cookie:owner,body:{action:'create',name:role,email,password:'StaffPassword123!',role}});
      assert.equal(r.status,200,`create ${role}: ${JSON.stringify(r.data)}`);
    }
    const superCookie=await login('super@example.test','StaffPassword123!');
    const subCookie=await login('sub@example.test','StaffPassword123!');
    const supportCookie=await login('support@example.test','StaffPassword123!');
    assert.equal((await request('/api/admin/overview',{cookie:supportCookie})).status,200);
    assert.equal((await request('/api/admin/admins',{cookie:supportCookie})).status,200);
    assert.equal((await request('/api/admin/settings',{method:'POST',cookie:supportCookie,body:{notice:'x'}})).status,403);
    assert.equal((await request('/api/admin/users',{cookie:subCookie})).status,200);
    assert.equal((await request('/api/admin/settings',{method:'POST',cookie:subCookie,body:{notice:'x'}})).status,403);
    assert.equal((await request('/api/admin/panels',{cookie:superCookie})).status,403);
    assert.equal((await request('/api/admin/admins',{cookie:superCookie})).status,200);
    const forbidden=await request('/api/admin/admins/manage',{method:'POST',cookie:superCookie,body:{action:'create',name:'Bad',email:'bad@example.test',password:'StaffPassword123!',role:'superAdmin'}});
    assert.equal(forbidden.status,400);
    console.log('PASS: new admin role creation and login');
    console.log('PASS: Support Admin read-only restrictions');
    console.log('PASS: Sub Admin user-directory and settings restrictions');
    console.log('PASS: Super Admin panel-owner restrictions and scoped admin management');
    console.log('ALL ADMIN ROLE TESTS PASSED');
  } catch(e) { console.error(e); process.exitCode=1; }
  finally { child.kill(); fs.rmSync(dir,{recursive:true,force:true}); }
})();
