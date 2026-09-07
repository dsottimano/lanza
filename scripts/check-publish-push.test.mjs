import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkPublishPush } from './check-publish-push.mjs';

test('push guard fetches staging and refuses unreconciled drafts; allows their merge',()=>{
  const root=mkdtempSync(join(tmpdir(),'lanza-push-'));
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  try {
    git('init');git('config','user.email','test@example.test');git('config','user.name','Test');
    writeFileSync(join(root,'file'),'base');git('add','.');git('commit','-m','base');git('branch','-M','main');
    git('checkout','-b','staging');writeFileSync(join(root,'draft'),'human edit');git('add','.');git('commit','-m','human draft');
    const draft=git('rev-parse','HEAD');git('checkout','main');
    writeFileSync(join(root,'code'),'agent change');git('add','.');git('commit','-m','agent change');
    const main=git('rev-parse','HEAD');
    assert.throws(()=>checkPublishPush(root,[{remoteRef:'refs/heads/main',sha:main}],root),/CMS staging contains work/);
    git('merge','--no-edit','staging');
    assert.doesNotThrow(()=>checkPublishPush(root,[{remoteRef:'refs/heads/main',sha:git('rev-parse','HEAD')}],root));
    assert.doesNotThrow(()=>checkPublishPush(root,[{remoteRef:'refs/heads/staging',sha:draft}],root));
    assert.throws(()=>checkPublishPush(root,[{remoteRef:'refs/heads/main',sha:'0'.repeat(40)}],root),/delete/);
  } finally {rmSync(root,{recursive:true,force:true});}
});
