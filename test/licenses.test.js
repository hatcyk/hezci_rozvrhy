const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Lucide is ISC licensed: every copy has to carry its copyright and
// permission notice. The browser only ever gets the generated sprite.
test('the icon sprite carries the Lucide licence notice', () => {
    const sprite = fs.readFileSync(path.join(__dirname, '..', 'public', 'icons.svg'), 'utf8');
    const license = fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'lucide-static', 'LICENSE'), 'utf8');
    const notice = license.match(/Permission to use[\s\S]*?appear in all copies\./)[0];
    assert.ok(sprite.includes(notice), 'permission notice');
    assert.match(sprite, /Copyright \(c\) for portions of Lucide/);
    assert.match(sprite, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"><!--[\s\S]*?-->\n<symbol /);
});
