# Stored credentials do not prove a connection

Read this before changing credential, provider verification or connection-status semantics.

A stored credential and selected model prove only that the provider is `configured`. The `verified`
state requires a successful, uncached connection test with usable output for that exact provider/model
pair; an output-limit result is `incomplete`. Changing either the credential or selection invalidates
the proof, and a stale result cannot restore it. Do not simplify the badge to credential presence: doing
so reports connectivity and model access that the server has never observed and can preserve a result
belonging to different configuration.
