<!--
 * @Author: trexwb trexwb@qq.com
 * @Date: 2026-08-23 14:22:08
 * @LastEditors: trexwb trexwb@qq.com
 * @LastEditTime: 2026-08-23 14:25:12
 * @FilePath: /WeChatOfficialAccount/Users/wbtrex/AI助手/node/trexwb/lockPass/src/App.vue
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
-->
<script setup>
/* LockPass — 根组件：认证视图 / 主界面切换 */
import { onMounted } from 'vue'
import { useVault, vaultState } from './composables/useVault'
import { useShortcuts } from './composables/useShortcuts'
import AuthView from './components/auth/AuthView.vue'
import AppShell from './components/AppShell.vue'
import ModalHost from './components/ModalHost.vue'

const { boot } = useVault()
useShortcuts()

onMounted(() => {
  boot()
})
</script>

<template>
  <div id="app-root">
    <AuthView v-if="!vaultState.isUnlocked" />
    <AppShell v-else />
    <ModalHost />
  </div>
</template>
