# Ranked alternatives and predictions (before API measurements)

Historical note: these predictions used a stronger ownership requirement before
the user accepted persistent blocking and the narrow manual-launch race during
connection. They are preserved as written. The current accepted requirements
and practical verdict are in [the strategy report](README-factory-strategy.md);
the identity prerequisites below apply to the optional stronger guarantee.

1. Decode the raw IClassFactory proxy with documented CoDecodeProxy before
   CreateInstance. A successful result supplies the actual server PID;
   combine it with a held process handle/start time and exclude every
   preexisting or concurrently launched process not proven experiment-owned.
   Prediction: debugger/developer-license restrictions may return
   E_ACCESSDENIED to the normal desktop user. This must be a prerequisite
   failure, with no CreateInstance on an unidentified factory.
2. Test CLSCTX_LOCAL_SERVER | CLSCTX_DISABLE_AAA against an available original
   and after exhaustion. Prediction: this flag is a security restriction,
   not a documented running-only lookup. It may deny the request outright
   or still launch under a configured identity. Only the observed matrix can
   justify using it as a drain primitive on this installation.
3. Drain factories adaptively, without a process-count target, then create
   the owned object from the exact last factory. Prediction: in a quiescent
   session this avoids the old extra server. A new PID alone is insufficient
   during concurrent manual launches/activations. Exact-factory identity or
   a separately proven provenance mechanism is required before CreateInstance.
4. Track reserved PID/start identities and held-client identities. These
   distinguish known roles and prevent PID-reuse mistakes, but tracking alone
   does not enumerate the COM class table or map an arbitrary returned proxy.
   Also investigate documented ROT and activation/identity mechanisms; do not
   parse undocumented OBJREF/RPC internals or inject code into Stata.

Success means one new owned Automation object, zero orphan extra servers,
preserved original datasets/macros/unsaved state, and unaffected existing
clients. Persistent blocking is acceptable. Unavailable identification or
ambiguous provenance must fail explicitly, with no global CreateObject fallback.
