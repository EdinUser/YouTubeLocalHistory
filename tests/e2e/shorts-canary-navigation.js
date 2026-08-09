function isReadyOrganicShortState(
  state,
  { previousVideoId = '', expectedVideoId = '' } = {}
) {
  return !!state
    && state.found === true
    && Number(state.readyState) >= 1
    && Number(state.duration) > 0
    && !!state.videoId
    && state.videoId !== previousVideoId
    && (!expectedVideoId || state.videoId === expectedVideoId)
    && state.reelVideoId === state.videoId
    && !!String(state.title || '').trim()
    && !!String(state.channelName || '').trim()
    && !!String(state.channelId || '').trim();
}

function describeShortState(state) {
  if (!state) return '(no Shorts state)';
  return JSON.stringify({
    videoId: state.videoId || '',
    reelVideoId: state.reelVideoId || '',
    found: state.found === true,
    readyState: Number(state.readyState) || 0,
    duration: Number(state.duration) || 0,
    hasTitle: !!String(state.title || '').trim(),
    hasChannelName: !!String(state.channelName || '').trim(),
    hasChannelId: !!String(state.channelId || '').trim(),
  });
}

async function advanceToNextOrganicShort({
  previousVideoId,
  advance,
  waitForOrganic,
  readState,
  maxAttempts = 5,
}) {
  const observedStates = [];
  let lastError;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await advance(attempt);
    try {
      return await waitForOrganic(attempt);
    } catch (error) {
      lastError = error;
      try {
        observedStates.push(await readState());
      } catch (stateError) {
        observedStates.push({ diagnosticError: stateError.message });
      }
    }
  }

  const stateDetails = observedStates.map(describeShortState).join(', ');
  const error = new Error(
    `Failed to advance from Short ${previousVideoId} to an organic Short after ${maxAttempts} attempts. `
    + `Observed states: ${stateDetails || '(none)'}. Last wait: ${lastError?.message || '(none)'}`
  );
  error.cause = lastError;
  throw error;
}

module.exports = {
  advanceToNextOrganicShort,
  describeShortState,
  isReadyOrganicShortState,
};
