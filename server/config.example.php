<?php
// Upload as think-private/config.php OUTSIDE the public www directory.
// Open tools/reminder-keys.html locally to generate the secret and its verifier.
// Upload only the verifier below. Keep the actual key in your password manager.
// Setup removes this verifier after creating the owner's password hash.
return ['setup_key_hash' => 'REPLACE_WITH_THE_64_CHARACTER_SHA256_VERIFIER'];
