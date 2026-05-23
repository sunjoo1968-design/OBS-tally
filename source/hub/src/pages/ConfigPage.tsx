import React from 'react'
import Layout from '../components/layout/Layout'
import AtemSettings from '../mixer/atem/react/AtemSettings'
import MixerSelection from '../components/config/MixerSelection'
import ObsSettings from '../mixer/obs/react/ObsSettings'
import VmixSettings from '../mixer/vmix/react/VmixSettings'

const ConfigPage = () => {
  return (
    <Layout testId="config">
      <MixerSelection>
        <AtemSettings />
        <ObsSettings />
        <VmixSettings />
      </MixerSelection>
    </Layout>
  )
}
export default ConfigPage;
