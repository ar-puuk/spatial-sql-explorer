<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'>
<qgis version="3.34.0" styleCategories="Symbology|Symbology3D|Rendering|CustomProperties">
  <renderer-v2 type="graduatedSymbol" attr="v * 1.5 + 1" graduatedMethod="GraduatedColor" symbollevels="0" forceraster="0" enableorderby="0" referencescale="-1">
    <ranges>
      <range lower="1" upper="25" label="1 – 25" render="true" symbol="0"/>
      <range lower="25" upper="46" label="25 – 46" render="true" symbol="1"/>
      <range lower="46" upper="67" label="46 – 67" render="true" symbol="2"/>
      <range lower="67" upper="88" label="67 – 88" render="true" symbol="3"/>
    </ranges>
    <symbols>
      <symbol type="fill" name="0" alpha="1" clip_to_extent="1" force_rhr="0">
        <layer class="SimpleFill" enabled="1" locked="0" pass="0">
          <Option type="Map">
            <Option name="color" type="QString" value="68,1,84,191"/>
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
            <Option name="color" type="QString" value="51,103,141,191"/>
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
            <Option name="color" type="QString" value="59,183,119,191"/>
            <Option name="joinstyle" type="QString" value="round"/>
            <Option name="outline_color" type="QString" value="75,85,99,204"/>
            <Option name="outline_style" type="QString" value="solid"/>
            <Option name="outline_width" type="QString" value="0.5"/>
            <Option name="outline_width_unit" type="QString" value="Pixel"/>
            <Option name="style" type="QString" value="solid"/>
          </Option>
        </layer>
      </symbol>
      <symbol type="fill" name="3" alpha="1" clip_to_extent="1" force_rhr="0">
        <layer class="SimpleFill" enabled="1" locked="0" pass="0">
          <Option type="Map">
            <Option name="color" type="QString" value="253,231,37,191"/>
            <Option name="joinstyle" type="QString" value="round"/>
            <Option name="outline_color" type="QString" value="75,85,99,204"/>
            <Option name="outline_style" type="QString" value="solid"/>
            <Option name="outline_width" type="QString" value="0.5"/>
            <Option name="outline_width_unit" type="QString" value="Pixel"/>
            <Option name="style" type="QString" value="solid"/>
          </Option>
        </layer>
      </symbol>
      <symbol type="fill" name="4" alpha="1" clip_to_extent="1" force_rhr="0">
        <layer class="SimpleFill" enabled="1" locked="0" pass="0">
          <Option type="Map">
            <Option name="color" type="QString" value="140,140,140,191"/>
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
    <classificationMethod id="Quantile"/>
    <rotation/>
    <sizescale/>
  </renderer-v2>
  <customproperties>
    <Option type="Map">
      <Option name="spatialExplorer/ramp" type="QString" value="viridis"/>
      <Option name="spatialExplorer/rampReversed" type="QString" value="false"/>
      <Option name="spatialExplorer/expression" type="QString" value="{&quot;expression&quot;:&quot;v * 1.5 + 1&quot;,&quot;column&quot;:&quot;v times 1.5&quot;}"/>
      <Option name="spatialExplorer/noValue" type="QString" value="{&quot;color&quot;:&quot;#8c8c8c&quot;,&quot;label&quot;:&quot;No value&quot;,&quot;visible&quot;:true}"/>
    </Option>
  </customproperties>
  <layerOpacity>1</layerOpacity>
  <layerGeometryType>2</layerGeometryType>
</qgis>
