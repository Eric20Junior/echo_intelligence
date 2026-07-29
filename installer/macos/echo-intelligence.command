#!/bin/bash
# Copied into the bundle at Contents/Resources/app/bin/ and opened by
# Contents/MacOS/launcher via Terminal. Sole job: cd into bin/ before exec'ing,
# because the SEA binary resolves data/ and public/ as siblings of its own folder
# (backend/lib/paths.js) and Terminal starts everything in $HOME.
#
# exec, not a plain call: the operator closing this Terminal window is the
# documented way to stop the app, and exec means the window is really running the
# app rather than a shell babysitting it.
cd "$(dirname "$0")"
exec ./echo-intelligence
