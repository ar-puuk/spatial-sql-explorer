<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'>
<qgis version="3.34.0" styleCategories="Symbology|Symbology3D|Rendering|CustomProperties">
  <renderer-v2 type="RuleRenderer" symbollevels="0" forceraster="0" enableorderby="0" referencescale="-1">
    <rules key="{se-rules}">
      <rule filter="v &gt; 40" key="{se-rule-r1}" label="Big" symbol="0"/>
      <rule filter="(kind = 'b') AND NOT coalesce((v &gt; 40), FALSE)" key="{se-rule-r2}" label="kind = 'b'" symbol="1" checkstate="0"/>
      <rule filter="ELSE" key="{se-else}" label="Everything else" symbol="2"/>
    </rules>
    <symbols>
      <symbol type="fill" name="0" alpha="1" clip_to_extent="1" force_rhr="0">
        <layer class="SimpleFill" enabled="1" locked="0" pass="0">
          <Option type="Map">
            <Option name="color" type="QString" value="228,26,28,191"/>
            <Option name="joinstyle" type="QString" value="round"/>
            <Option name="outline_color" type="QString" value="75,85,99,204"/>
            <Option name="outline_style" type="QString" value="solid"/>
            <Option name="outline_width" type="QString" value="0.5"/>
            <Option name="outline_width_unit" type="QString" value="Pixel"/>
            <Option name="style" type="QString" value="solid"/>
          </Option>
        </layer>
      </symbol>
      <symbol type="fill" name="1" alpha="1" clip_to_extent="1" force_rhr="0">
        <layer class="SimpleFill" enabled="1" locked="0" pass="0">
          <Option type="Map">
            <Option name="color" type="QString" value="55,126,184,191"/>
            <Option name="joinstyle" type="QString" value="round"/>
            <Option name="outline_color" type="QString" value="75,85,99,204"/>
            <Option name="outline_style" type="QString" value="solid"/>
            <Option name="outline_width" type="QString" value="0.5"/>
            <Option name="outline_width_unit" type="QString" value="Pixel"/>
            <Option name="style" type="QString" value="solid"/>
          </Option>
        </layer>
      </symbol>
      <symbol type="fill" name="2" alpha="1" clip_to_extent="1" force_rhr="0">
        <layer class="SimpleFill" enabled="1" locked="0" pass="0">
          <Option type="Map">
            <Option name="color" type="QString" value="189,189,189,191"/>
            <Option name="joinstyle" type="QString" value="round"/>
            <Option name="outline_color" type="QString" value="75,85,99,204"/>
            <Option name="outline_style" type="QString" value="solid"/>
            <Option name="outline_width" type="QString" value="0.5"/>
            <Option name="outline_width_unit" type="QString" value="Pixel"/>
            <Option name="style" type="QString" value="solid"/>
          </Option>
        </layer>
      </symbol>
    </symbols>
  </renderer-v2>
  <customproperties>
    <Option type="Map">
      <Option name="spatialExplorer/rules" type="QString" value="{&quot;kind&quot;:&quot;rules&quot;,&quot;rules&quot;:[{&quot;id&quot;:&quot;r1&quot;,&quot;label&quot;:&quot;Big&quot;,&quot;where&quot;:&quot;v &gt; 40&quot;,&quot;color&quot;:&quot;#e41a1c&quot;,&quot;visible&quot;:true},{&quot;id&quot;:&quot;r2&quot;,&quot;label&quot;:&quot;&quot;,&quot;where&quot;:&quot;kind = 'b'&quot;,&quot;color&quot;:&quot;#377eb8&quot;,&quot;visible&quot;:false},{&quot;id&quot;:&quot;r3&quot;,&quot;label&quot;:&quot;Broken&quot;,&quot;where&quot;:&quot;nope &gt; 1&quot;,&quot;color&quot;:&quot;#4daf4a&quot;,&quot;visible&quot;:true}],&quot;elseColor&quot;:&quot;#bdbdbd&quot;,&quot;elseVisible&quot;:true,&quot;elseLabel&quot;:&quot;Everything else&quot;}"/>
    </Option>
  </customproperties>
  <layerOpacity>1</layerOpacity>
  <layerGeometryType>2</layerGeometryType>
</qgis>
