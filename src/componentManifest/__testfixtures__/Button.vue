<script setup lang="ts">
withDefaults(
  defineProps<{
    /** Button contents */
    label: string;
    /** Whether this is the primary call to action */
    primary?: boolean;
    /** How large the button should be */
    size?: 'small' | 'medium' | 'large';
  }>(),
  { primary: false, size: 'medium' }
);

defineEmits<{
  /** Emitted when the button is clicked */
  click: [event: MouseEvent];
}>();
</script>

<template>
  <button type="button" @click="$emit('click', $event)">
    {{ label }}
    <slot />
  </button>
</template>
