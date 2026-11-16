<script lang="ts">
  import { i18n } from '../lib/i18n.svelte';

  let {
    state,
    onretry,
    button = $bindable(),
    status = $bindable(),
  }: {
    state: 'ready' | 'unavailable' | 'busy' | 'recovered';
    onretry: () => void;
    button?: HTMLButtonElement;
    status?: HTMLParagraphElement;
  } = $props();
</script>

{#if state === 'unavailable' || state === 'busy'}
  <div class="detail-recovery" role="alert" data-spatial-section>
    <span>{i18n.phrase('Some title details couldn’t be loaded.')}</span>
    <button
      bind:this={button}
      type="button"
      class="den-button den-button-compact"
      disabled={state === 'busy'}
      aria-busy={state === 'busy'}
      onclick={onretry}>{i18n.phrase('Try again')}</button
    >
  </div>
{:else if state === 'recovered'}
  <p bind:this={status} class="detail-recovered" role="status" tabindex="-1">
    {i18n.phrase('Title details loaded.')}
  </p>
{/if}

<style>
  .detail-recovery {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    margin: 0 0 20px;
    color: var(--danger);
  }

  .detail-recovered {
    margin: 0 0 20px;
    color: var(--muted);
  }

  .detail-recovered:focus {
    outline: none;
  }
</style>
